import Foundation

/// The three folders Vamp runs from (installer.plan.md Phase 1), the same
/// ones the bridge (`interface/bridge/utils/dataPaths.js`), the interface
/// server (`runtimeConfig.ts`) and the control surface (`vamp-paths.json`)
/// read.
///
/// - `app`: what ships, `config/constants.json` and the server.
/// - `data`: everything written, `config/` (the local constants, the
///   secret, paired iPads), `logs/`, `cache/`.
/// - `devices`: the Vamp Devices folder.
///
/// From a checkout (a `repoRoot`), all three are the checkout, so the rig
/// writes where it always has. Installed (no `repoRoot`, the server inside
/// the app), `app` is the bundle's `Resources/vamp`, `data` is
/// `~/Library/Application Support/Vamp`, and `devices` is the folder the
/// user picked, `~/Music/Vamp/Vamp Devices` until they pick.
struct VampPaths: Equatable {
    let app: URL
    let data: URL
    let devices: URL
    let installed: Bool

    /// The Node the app ships, beside the server (`Resources/node/bin/node`).
    var node: URL {
        app.deletingLastPathComponent().appendingPathComponent("node/bin/node")
    }

    /// Recorded when the user picks where Vamp Devices goes.
    static let devicesKey = "devicesFolder"

    static func checkout(_ root: URL) -> VampPaths {
        VampPaths(app: root, data: root, devices: root.appendingPathComponent("Vamp Devices"), installed: false)
    }

    static func installed(bundle: URL, home: URL, chosenDevices: String?) -> VampPaths {
        let devices = chosenDevices.flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: $0) }
            ?? home.appendingPathComponent("Music/Vamp/Vamp Devices")
        return VampPaths(
            app: bundle.appendingPathComponent("Contents/Resources/vamp"),
            data: home.appendingPathComponent("Library/Application Support/Vamp"),
            devices: devices,
            installed: true
        )
    }

    /// `config`, `logs` or `cache`: a checkout's are `config/`, `logs/` and
    /// `scripts/.cache/`, as the bridge's `dataDir` has them.
    func dataDir(_ kind: String) -> URL {
        if !installed && kind == "cache" { return data.appendingPathComponent("scripts/.cache") }
        return data.appendingPathComponent(kind)
    }

    /// What the app hands the processes it starts: unset from a checkout,
    /// where each finds the checkout itself.
    var environment: [String: String] {
        guard installed else { return [:] }
        return ["VAMP_APP_ROOT": app.path, "VAMP_DATA": data.path, "VAMP_DEVICES": devices.path]
    }

    /// The control surface's copy of the same (`config_loader.vamp_paths`).
    var surfaceFile: [String: String] {
        ["app": app.path, "data": data.path, "devices": devices.path]
    }

    /// This app's folders: the checkout's when it has one, else the
    /// bundle's when the bundle carries the server, else none.
    static func current(repoRoot: URL?) -> VampPaths? {
        if let repoRoot { return checkout(repoRoot) }
        let bundle = Bundle.main.bundleURL
        let paths = installed(
            bundle: bundle,
            home: FileManager.default.homeDirectoryForCurrentUser,
            chosenDevices: UserDefaults.standard.string(forKey: devicesKey)
        )
        let shipped = paths.app.appendingPathComponent("config/constants.json").path
        return FileManager.default.fileExists(atPath: shipped) ? paths : nil
    }
}
