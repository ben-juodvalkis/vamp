import AppKit
import CoreImage.CIFilterBuiltins
import Foundation

/// The installed app's own menu work (installer.plan.md Phase 4): putting
/// the surface and Vamp Devices in place at launch, the iPad's address as a
/// QR code, and uninstalling. None of it runs from a checkout.
extension Supervisor {
    /// Where the app keeps what it ships beside the server.
    private var resources: URL? { paths.map { $0.app.deletingLastPathComponent() } }

    private var userLibrary: URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return FirstLaunch.userLibrary(prefsDir: home.appendingPathComponent("Library/Preferences/Ableton"), home: home)
    }

    private var version: String {
        let info = Bundle.main.infoDictionary
        return "\(info?["CFBundleShortVersionString"] ?? "0") (\(info?["CFBundleVersion"] ?? "0"))"
    }

    /// At launch: ask once where Vamp Devices goes, then copy the devices
    /// and the surface. Says in the menu what Live still needs.
    func setUpInstalled() {
        guard let resources else { return }
        if UserDefaults.standard.string(forKey: VampPaths.devicesKey) == nil, let picked = askWhereDevicesGo() {
            UserDefaults.standard.set(picked.path, forKey: VampPaths.devicesKey)
            choseDevices()
        }
        guard let paths else { return }
        do {
            try FirstLaunch.installDevices(from: resources.appendingPathComponent("Vamp Devices"), to: paths.devices)
        } catch {
            VampLog.line("— could not copy Vamp Devices to \(paths.devices.path): \(error.localizedDescription) —")
        }
        let target = userLibrary.appendingPathComponent("Remote Scripts/Vamp")
        let first = !FileManager.default.fileExists(atPath: target.path)
        let surface = FirstLaunch.installSurface(from: resources.appendingPathComponent("surface"), userLibrary: userLibrary, paths: paths, version: version)
        VampLog.line("— control surface: \(surface) at \(target.path) —")
        switch surface {
        case .updated:
            setLiveNote(first
                ? "In Live: Settings → Link, Tempo & MIDI, pick Vamp as a Control Surface, then restart Live"
                : "Restart Live to finish updating Vamp")
        case .failed(let why):
            setLiveNote("Could not put the control surface in Live's User Library: \(why)")
        case .current, .leftSymlink:
            setLiveNote(nil)
        }
    }

    /// The user's choice of folder for Vamp Devices: their own Music folder
    /// (the default) or Live's User Library (Ben, 2026-11-01). Either way they
    /// add it to Live's Places themselves.
    private func askWhereDevicesGo() -> URL? {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let music = home.appendingPathComponent("Music/Vamp/Vamp Devices")
        let library = userLibrary.appendingPathComponent("Vamp Devices")
        let alert = NSAlert()
        alert.messageText = "Where should Vamp Devices go?"
        alert.informativeText = """
            Permute, the on-screen wheels, Capture and Vamp's groove come from this folder. \
            Add it to Live's Places to turn them on.

            Your Music folder: \(music.path)
            Live's User Library: \(library.path)
            """
        alert.addButton(withTitle: "Music Folder")
        alert.addButton(withTitle: "User Library")
        alert.addButton(withTitle: "Choose…")
        NSApp.activate(ignoringOtherApps: true)
        switch alert.runModal() {
        case .alertFirstButtonReturn: return music
        case .alertSecondButtonReturn: return library
        default:
            let panel = NSOpenPanel()
            panel.canChooseDirectories = true
            panel.canChooseFiles = false
            panel.canCreateDirectories = true
            panel.prompt = "Put Vamp Devices Here"
            return panel.runModal() == .OK ? panel.url?.appendingPathComponent("Vamp Devices") : music
        }
    }

    /// The iPad's address as a QR code, for an iPad without Vamp for iPad to
    /// open in Safari by pointing its camera at it (Ben, 2026-10-31).
    func showQRCode() {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(iPadAddress.utf8)
        filter.correctionLevel = "M"
        guard let code = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)) else { return }
        let rep = NSCIImageRep(ciImage: code)
        let image = NSImage(size: rep.size)
        image.addRepresentation(rep)
        let side: CGFloat = 280
        let view = NSImageView(frame: NSRect(x: 20, y: 44, width: side, height: side))
        view.image = image
        view.imageScaling = .scaleProportionallyUpOrDown
        let label = NSTextField(labelWithString: iPadAddress)
        label.frame = NSRect(x: 20, y: 14, width: side, height: 20)
        label.alignment = .center
        let window = NSPanel(contentRect: NSRect(x: 0, y: 0, width: side + 40, height: side + 64),
                             styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Open Vamp on the iPad"
        window.contentView?.addSubview(view)
        window.contentView?.addSubview(label)
        window.isReleasedWhenClosed = false
        window.center()
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        qrWindow = window
    }

    /// Remove the surface from Live, ask about the data, then put the app in
    /// the Trash and quit. Vamp Devices stays: it may hold the user's own files.
    func uninstall() {
        let confirm = NSAlert()
        confirm.messageText = "Uninstall Vamp?"
        confirm.informativeText = "This removes Vamp's control surface from Live and moves Vamp to the Trash. Vamp Devices stays where it is."
        confirm.addButton(withTitle: "Uninstall")
        confirm.addButton(withTitle: "Cancel")
        NSApp.activate(ignoringOtherApps: true)
        guard confirm.runModal() == .alertFirstButtonReturn else { return }
        stopForQuit()
        _ = FirstLaunch.removeSurface(userLibrary: userLibrary)
        if let data = paths?.data, FileManager.default.fileExists(atPath: data.path) {
            let ask = NSAlert()
            ask.messageText = "Keep Vamp's settings?"
            ask.informativeText = "Paired iPads, your Places choices and the logs are in \(data.path)."
            ask.addButton(withTitle: "Keep Them")
            ask.addButton(withTitle: "Delete Them")
            if ask.runModal() == .alertSecondButtonReturn { try? FileManager.default.removeItem(at: data) }
        }
        NSWorkspace.shared.recycle([Bundle.main.bundleURL]) { _, _ in
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }
}
