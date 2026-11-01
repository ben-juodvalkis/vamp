import Foundation

/// What the installed app puts in place on each launch (installer.plan.md
/// Phase 4): the control surface in Live's Remote Scripts, with
/// `vamp-paths.json` beside it, and the Vamp Devices folder where the user
/// chose. A checkout never runs this: its surface is `npm run setup`'s
/// symlink and its devices are in the repo.
enum FirstLaunch {
    /// What happened to the control surface.
    enum Surface: Equatable {
        /// Copied, and different from what was there: Live runs the old one
        /// until it restarts.
        case updated
        /// Already this version.
        case current
        /// A symlink is there (a checkout's `npm run setup`): left alone.
        case leftSymlink
        case failed(String)
    }

    /// Live's User Library: from the `Library.cfg` Live wrote last (the Live
    /// in use, by mtime, as `interface/src/lib/server/libraryCfg.ts` finds
    /// it), else Live's default folder.
    static func userLibrary(prefsDir: URL, home: URL) -> URL {
        let fm = FileManager.default
        let dirs = (try? fm.contentsOfDirectory(at: prefsDir, includingPropertiesForKeys: nil)) ?? []
        let cfgs = dirs.map { $0.appendingPathComponent("Library.cfg") }.compactMap { url -> (URL, Date)? in
            guard let m = (try? fm.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date else { return nil }
            return (url, m)
        }
        if let newest = cfgs.max(by: { $0.1 < $1.1 })?.0,
           let xml = try? String(contentsOf: newest, encoding: .utf8),
           let library = userLibrary(libraryCfg: xml) {
            return library
        }
        return home.appendingPathComponent("Music/Ableton/User Library")
    }

    /// `ProjectPath` + `ProjectName` of the `LibraryProject` in a `Library.cfg`.
    static func userLibrary(libraryCfg xml: String) -> URL? {
        guard let project = firstMatch(#"<LibraryProject\b[^>]*>([\s\S]*?)</LibraryProject>"#, in: xml),
              let dir = firstMatch(#"<ProjectPath\s+Value="([^"]*)""#, in: project),
              let name = firstMatch(#"<ProjectName\s+Value="([^"]*)""#, in: project),
              dir.hasPrefix("/") else { return nil }
        return URL(fileURLWithPath: decodeEntities(dir)).appendingPathComponent(decodeEntities(name))
    }

    /// Copy `source` (the app's `surface`) to `<userLibrary>/Remote Scripts/Vamp`
    /// with `vamp-paths.json` beside it. `version` is the app's: the copy
    /// records it, and a copy of the same version is not touched.
    static func installSurface(from source: URL, userLibrary: URL, paths: VampPaths, version: String) -> Surface {
        let fm = FileManager.default
        let target = userLibrary.appendingPathComponent("Remote Scripts/Vamp")
        if (try? fm.destinationOfSymbolicLink(atPath: target.path)) != nil { return .leftSymlink }
        let stamp = target.appendingPathComponent("vamp-version")
        let pathsData = try? JSONSerialization.data(withJSONObject: paths.surfaceFile, options: [.prettyPrinted, .sortedKeys])
        let pathsFile = target.appendingPathComponent("vamp-paths.json")
        if (try? String(contentsOf: stamp, encoding: .utf8)) == version,
           (try? Data(contentsOf: pathsFile)) == pathsData {
            return .current
        }
        do {
            // Built beside the target and swapped in, so Live never finds half a surface.
            let staging = target.deletingLastPathComponent().appendingPathComponent(".Vamp-installing")
            try? fm.removeItem(at: staging)
            try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try fm.copyItem(at: source, to: staging)
            try pathsData?.write(to: staging.appendingPathComponent("vamp-paths.json"))
            try version.write(to: staging.appendingPathComponent("vamp-version"), atomically: true, encoding: .utf8)
            if fm.fileExists(atPath: target.path) {
                _ = try fm.replaceItemAt(target, withItemAt: staging)
            } else {
                try fm.moveItem(at: staging, to: target)
            }
            return .updated
        } catch {
            return .failed(error.localizedDescription)
        }
    }

    /// Copy every file the app ships in Vamp Devices into `destination`,
    /// replacing older copies; anything else the user keeps there stays.
    static func installDevices(from source: URL, to destination: URL) throws {
        let fm = FileManager.default
        // Resolved, so `/var/…` and `/private/var/…` name the same folder.
        let base = source.resolvingSymlinksInPath().path
        guard let walker = fm.enumerator(at: source, includingPropertiesForKeys: [.isDirectoryKey]) else { return }
        for case let file as URL in walker {
            let rel = String(file.resolvingSymlinksInPath().path.dropFirst(base.count + 1))
            let out = destination.appendingPathComponent(rel)
            if (try? file.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true {
                try fm.createDirectory(at: out, withIntermediateDirectories: true)
                continue
            }
            if fm.contentsEqual(atPath: file.path, andPath: out.path) { continue }
            try? fm.removeItem(at: out)
            try fm.createDirectory(at: out.deletingLastPathComponent(), withIntermediateDirectories: true)
            try fm.copyItem(at: file, to: out)
        }
    }

    /// Remove the copied surface (never a symlink). Data and devices are the
    /// user's to keep or delete; the caller asks.
    static func removeSurface(userLibrary: URL) -> Bool {
        let target = userLibrary.appendingPathComponent("Remote Scripts/Vamp")
        if (try? FileManager.default.destinationOfSymbolicLink(atPath: target.path)) != nil { return false }
        return (try? FileManager.default.removeItem(at: target)) != nil
    }

    private static func firstMatch(_ pattern: String, in text: String) -> String? {
        guard let re = try? NSRegularExpression(pattern: pattern),
              let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let r = Range(m.range(at: 1), in: text) else { return nil }
        return String(text[r])
    }

    private static func decodeEntities(_ s: String) -> String {
        s.replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&apos;", with: "'")
            .replacingOccurrences(of: "&amp;", with: "&")
    }
}
