import XCTest

/// First-launch setup (installer.plan.md Phase 4), on throwaway folders.
final class FirstLaunchTests: XCTestCase {
    private var tmp: URL!
    private let fm = FileManager.default

    override func setUpWithError() throws {
        tmp = fm.temporaryDirectory.appendingPathComponent("FirstLaunchTests-\(UUID().uuidString)")
        try fm.createDirectory(at: tmp, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? fm.removeItem(at: tmp)
    }

    private func write(_ text: String, _ rel: String) throws {
        let url = tmp.appendingPathComponent(rel)
        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    private var paths: VampPaths {
        VampPaths.installed(bundle: tmp.appendingPathComponent("Vamp.app"), home: tmp, chosenDevices: nil)
    }

    func testTheUserLibraryComesFromTheLibraryCfgLiveWroteLast() throws {
        let cfg = { (dir: String) in
            "<Ableton><LibraryProject><ProjectPath Value=\"\(dir)\" /><ProjectName Value=\"User Library\" /></LibraryProject></Ableton>"
        }
        try write(cfg("/Old/Libraries"), "prefs/Live 12.4b7/Library.cfg")
        try fm.setAttributes([.modificationDate: Date(timeIntervalSinceNow: -86400)],
                             ofItemAtPath: tmp.appendingPathComponent("prefs/Live 12.4b7/Library.cfg").path)
        try write(cfg("/Shared/Music &amp; Libraries"), "prefs/Live 12.4.15b2/Library.cfg")
        let found = FirstLaunch.userLibrary(prefsDir: tmp.appendingPathComponent("prefs"), home: tmp)
        XCTAssertEqual(found.path, "/Shared/Music & Libraries/User Library")
        XCTAssertEqual(FirstLaunch.userLibrary(prefsDir: tmp.appendingPathComponent("none"), home: tmp).path,
                       tmp.appendingPathComponent("Music/Ableton/User Library").path, "no prefs: Live's default")
    }

    func testTheSurfaceIsCopiedOnceAVersionWithItsFolders() throws {
        try write("surface v1", "app/surface/LoopingSurface.py")
        let library = tmp.appendingPathComponent("User Library")
        let source = tmp.appendingPathComponent("app/surface")
        XCTAssertEqual(FirstLaunch.installSurface(from: source, userLibrary: library, paths: paths, version: "1.0"), .updated)
        let target = library.appendingPathComponent("Remote Scripts/Vamp")
        XCTAssertEqual(try String(contentsOf: target.appendingPathComponent("LoopingSurface.py"), encoding: .utf8), "surface v1")
        let json = try JSONSerialization.jsonObject(with: Data(contentsOf: target.appendingPathComponent("vamp-paths.json"))) as? [String: String]
        XCTAssertEqual(json?["data"], tmp.appendingPathComponent("Library/Application Support/Vamp").path)
        XCTAssertEqual(FirstLaunch.installSurface(from: source, userLibrary: library, paths: paths, version: "1.0"), .current)
        try write("surface v2", "app/surface/LoopingSurface.py")
        XCTAssertEqual(FirstLaunch.installSurface(from: source, userLibrary: library, paths: paths, version: "1.1"), .updated)
        XCTAssertEqual(try String(contentsOf: target.appendingPathComponent("LoopingSurface.py"), encoding: .utf8), "surface v2")
        XCTAssertTrue(FirstLaunch.removeSurface(userLibrary: library))
        XCTAssertFalse(fm.fileExists(atPath: target.path))
    }

    func testACheckoutsSymlinkIsLeftAlone() throws {
        try write("x", "repo/surface/LoopingSurface.py")
        let library = tmp.appendingPathComponent("User Library")
        try fm.createDirectory(at: library.appendingPathComponent("Remote Scripts"), withIntermediateDirectories: true)
        let link = library.appendingPathComponent("Remote Scripts/Vamp")
        try fm.createSymbolicLink(at: link, withDestinationURL: tmp.appendingPathComponent("repo/surface"))
        XCTAssertEqual(FirstLaunch.installSurface(from: tmp.appendingPathComponent("repo/surface"), userLibrary: library, paths: paths, version: "1.0"), .leftSymlink)
        XCTAssertFalse(FirstLaunch.removeSurface(userLibrary: library))
        XCTAssertNotNil(try? fm.destinationOfSymbolicLink(atPath: link.path))
    }

    func testDevicesAreRefreshedAndTheUsersOwnFilesKept() throws {
        try write("permute v2", "ship/Permute/Permute.amxd")
        try write("permute v1", "mine/Permute/Permute.amxd")
        try write("my preset", "mine/My Stuff/preset.adv")
        try FirstLaunch.installDevices(from: tmp.appendingPathComponent("ship"), to: tmp.appendingPathComponent("mine"))
        XCTAssertEqual(try String(contentsOf: tmp.appendingPathComponent("mine/Permute/Permute.amxd"), encoding: .utf8), "permute v2")
        XCTAssertEqual(try String(contentsOf: tmp.appendingPathComponent("mine/My Stuff/preset.adv"), encoding: .utf8), "my preset")
    }
}
