import XCTest

/// The three folders (installer.plan.md Phase 1): a checkout keeps writing
/// into itself, an installed app into Application Support, with the same
/// layout the bridge's `dataPaths.js` gives.
final class VampPathsTests: XCTestCase {
    func testACheckoutWritesIntoItself() {
        let root = URL(fileURLWithPath: "/Users/u/vamp")
        let paths = VampPaths.checkout(root)
        XCTAssertEqual(paths.dataDir("config").path, "/Users/u/vamp/config")
        XCTAssertEqual(paths.dataDir("logs").path, "/Users/u/vamp/logs")
        XCTAssertEqual(paths.dataDir("cache").path, "/Users/u/vamp/scripts/.cache")
        XCTAssertEqual(paths.devices.path, "/Users/u/vamp/Vamp Devices")
        XCTAssertEqual(paths.environment, [:], "the children find the checkout themselves")
    }

    func testInstalledUsesApplicationSupportAndTheChosenDevices() {
        let home = URL(fileURLWithPath: "/Users/u")
        let bundle = URL(fileURLWithPath: "/Applications/Vamp.app")
        let picked = VampPaths.installed(bundle: bundle, home: home, chosenDevices: "/Users/u/Music/Ableton/User Library/Vamp Devices")
        XCTAssertEqual(picked.dataDir("cache").path, "/Users/u/Library/Application Support/Vamp/cache")
        XCTAssertEqual(picked.environment["VAMP_APP_ROOT"], "/Applications/Vamp.app/Contents/Resources/vamp")
        XCTAssertEqual(picked.environment["VAMP_DEVICES"], "/Users/u/Music/Ableton/User Library/Vamp Devices")
        XCTAssertEqual(picked.surfaceFile["data"], "/Users/u/Library/Application Support/Vamp")
        let unpicked = VampPaths.installed(bundle: bundle, home: home, chosenDevices: nil)
        XCTAssertEqual(unpicked.devices.path, "/Users/u/Music/Vamp/Vamp Devices")
    }
}
