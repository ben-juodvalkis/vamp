import Foundation

/// Runtime configuration sourced from `config/constants.json` — the project's
/// single source of truth (CLAUDE.md: "Never hardcode these values").
///
/// Only the values this app needs are read: the WebSocket port, the reconnect
/// base delay and the iPad link's ports. Addresses are wire contract, not
/// config (see `Wire`). This Mac's `config/constants.local.json` is laid
/// over it, as the bridge and the interface server lay it (config/CLAUDE.md).
///
/// Resolution order for constants.json (first hit wins):
///   1. $LOOPING_CONFIG            — explicit path to a constants.json
///   2. $LOOPING_PROJECT_ROOT      — <root>/config/constants.json
///   3. the `repoRoot` default `npm run install-mac-app` records
///   4. walk up from the current directory looking for config/constants.json
///   5. the copy inside the app, when it carries the server (installed)
///
/// If none is found the built-in fallbacks are used (same values the web UI
/// inlines in WebSocketConnection.ts for bootstrap), so the app still runs on
/// a machine where it can't locate the repo.
struct AppConfig {
    let host: String
    let webSocketPort: Int
    let reconnectDelayMs: Int
    /// Where constants.json was loaded from, or nil if the fallback was used.
    let sourcePath: String?
    /// `padLink` in constants.json: the iPad app's port, reached through
    /// usbmux, and the Mac page server each of its streams is spliced to.
    let padDevicePort: UInt16
    let padPagePort: UInt16

    /// Shared secret for the bridge's WebSocket auth challenge, if one
    /// could be read. `nil` means we cannot authenticate — the bridge
    /// will refuse our messages and send us nothing, which surfaces as
    /// a permanently-disconnected menu bar rather than a silent failure.
    ///
    /// Read from disk rather than fetched, because this app runs on the
    /// same Mac as the bridge and the file is the bridge's own store.
    let wsSecret: String?

    /// The checkout the config came from (`<root>/config/constants.json`),
    /// or nil when it came from inside the app (installed).
    var repoRoot: URL? {
        guard let sourcePath, !sourcePath.hasPrefix(Bundle.main.bundlePath + "/") else { return nil }
        return URL(fileURLWithPath: sourcePath).deletingLastPathComponent().deletingLastPathComponent()
    }

    /// Where Vamp reads and writes (`VampPaths`).
    var paths: VampPaths? { VampPaths.current(repoRoot: repoRoot) }

    static let fallback = AppConfig(
        host: "localhost",
        webSocketPort: 8081,
        reconnectDelayMs: 2000,
        sourcePath: nil,
        padDevicePort: 47800,
        padPagePort: 8889,
        wsSecret: nil
    )

    /// The configuration, read once for the whole app.
    static let shared = load()

    static func load() -> AppConfig {
        guard
            let url = locateConstants(),
            let data = try? Data(contentsOf: url),
            var json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return fallback
        }
        // This Mac's own files are in the data folder: the checkout's
        // config/ from a clone, Application Support when installed.
        let configDir = installedPaths(constantsAt: url)?.dataDir("config") ?? url.deletingLastPathComponent()
        let local = configDir.appendingPathComponent("constants.local.json")
        if let localData = try? Data(contentsOf: local),
           let overlay = try? JSONSerialization.jsonObject(with: localData) as? [String: Any] {
            json = merged(json, overlay)
        }

        let secret = loadSecret(in: configDir)

        let osc = json["osc"] as? [String: Any]
        let ws = osc?["webSocket"] as? [String: Any]
        let port = (ws?["port"] as? NSNumber)?.intValue ?? fallback.webSocketPort
        let reconnect = (osc?["reconnectDelay"] as? NSNumber)?.intValue ?? fallback.reconnectDelayMs

        // The bridge binds on 0.0.0.0; a same-machine client connects on
        // localhost (network.localhost), same as the web UI's localhost fallback.
        let localhost = (json["network"] as? [String: Any])?["localhost"] as? String ?? fallback.host

        let padLink = json["padLink"] as? [String: Any]
        let padDevice = (padLink?["devicePort"] as? NSNumber)?.uint16Value ?? fallback.padDevicePort
        let padPage = (padLink?["pagePort"] as? NSNumber)?.uint16Value ?? fallback.padPagePort

        return AppConfig(
            host: localhost,
            webSocketPort: port,
            reconnectDelayMs: reconnect,
            sourcePath: url.path,
            padDevicePort: padDevice,
            padPagePort: padPage,
            wsSecret: secret
        )
    }

    /// `overlay` laid over `base`: objects merge key by key, anything else
    /// is replaced (the bridge's `loadConstants` rule).
    static func merged(_ base: [String: Any], _ overlay: [String: Any]) -> [String: Any] {
        var out = base
        for (key, value) in overlay {
            if let inner = value as? [String: Any], let under = base[key] as? [String: Any] {
                out[key] = merged(under, inner)
            } else {
                out[key] = value
            }
        }
        return out
    }

    /// Read `config/.ws-secret`, or the `LOOPING_WS_SECRET` override.
    ///
    /// Same resolution order as the bridge's `utils/wsSecret.js`: env
    /// first, then the file. Unlike the bridge this never *generates*
    /// one — the bridge owns the file's lifecycle, and a client minting
    /// its own secret would simply fail the challenge in a more
    /// confusing way.
    private static func loadSecret(in configDir: URL) -> String? {
        let env = ProcessInfo.processInfo.environment
        if let fromEnv = env["LOOPING_WS_SECRET"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !fromEnv.isEmpty {
            return fromEnv
        }
        let secretURL = configDir.appendingPathComponent(".ws-secret")
        guard
            let raw = try? String(contentsOf: secretURL, encoding: .utf8)
        else {
            return nil
        }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func locateConstants() -> URL? {
        let fm = FileManager.default
        let env = ProcessInfo.processInfo.environment
        var candidates: [String] = []

        if let explicit = env["LOOPING_CONFIG"], !explicit.isEmpty {
            candidates.append(explicit)
        }
        if let root = env["LOOPING_PROJECT_ROOT"], !root.isEmpty {
            candidates.append(root + "/config/constants.json")
        }
        // Written by `npm run install-mac-app`: an app opened from the Dock
        // has no environment and no working directory to go on.
        if let root = UserDefaults.standard.string(forKey: "repoRoot"), !root.isEmpty {
            candidates.append(root + "/config/constants.json")
        }

        var dir = URL(fileURLWithPath: fm.currentDirectoryPath)
        for _ in 0..<8 {
            candidates.append(dir.appendingPathComponent("config/constants.json").path)
            dir.deleteLastPathComponent()
        }

        candidates.append(Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/vamp/config/constants.json").path)

        return candidates.first(where: { fm.fileExists(atPath: $0) }).map { URL(fileURLWithPath: $0) }
    }

    /// The installed folders when `url` is the copy inside the app.
    private static func installedPaths(constantsAt url: URL) -> VampPaths? {
        guard url.path.hasPrefix(Bundle.main.bundlePath + "/") else { return nil }
        return VampPaths.current(repoRoot: nil)
    }
}
