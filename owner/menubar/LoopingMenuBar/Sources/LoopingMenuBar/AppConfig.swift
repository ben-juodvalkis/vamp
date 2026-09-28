import Foundation

/// Runtime configuration sourced from `config/constants.json` — the project's
/// single source of truth (CLAUDE.md: "Never hardcode these values").
///
/// Only the values this app needs are read: the WebSocket port, the reconnect
/// base delay, and the server-presence timings. Addresses are wire contract,
/// not config (see `Wire`).
///
/// Resolution order for constants.json (first hit wins):
///   1. $LOOPING_CONFIG            — explicit path to a constants.json
///   2. $LOOPING_PROJECT_ROOT      — <root>/config/constants.json
///   3. /Users/Shared/DevWork/GitHub/vamp/config/constants.json
///      (matches constants.paths.projectRoot — the default rig install)
///   4. walk up from the current directory looking for config/constants.json
///
/// If none is found the built-in fallbacks are used (same values the web UI
/// inlines in WebSocketConnection.ts for bootstrap), so the app still runs on
/// a machine where it can't locate the repo.
struct AppConfig {
    let host: String
    let webSocketPort: Int
    let reconnectDelayMs: Int
    let heartbeatIntervalMs: Int
    let graceWindowMs: Int
    /// Where constants.json was loaded from, or nil if the fallback was used.
    let sourcePath: String?

    /// Shared secret for the bridge's WebSocket auth challenge, if one
    /// could be read. `nil` means we cannot authenticate — the bridge
    /// will refuse our messages and send us nothing, which surfaces as
    /// a permanently-disconnected menu bar rather than a silent failure.
    ///
    /// Read from disk rather than fetched, because this app runs on the
    /// same Mac as the bridge and the file is the bridge's own store.
    let wsSecret: String?

    static let fallback = AppConfig(
        host: "localhost",
        webSocketPort: 8081,
        reconnectDelayMs: 2000,
        heartbeatIntervalMs: 2000,
        graceWindowMs: 6000,
        sourcePath: nil,
        wsSecret: nil
    )

    static func load() -> AppConfig {
        guard
            let url = locateConstants(),
            let data = try? Data(contentsOf: url),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return fallback
        }

        // The secret sits beside constants.json, in the same config/
        // directory — so locating one locates the other.
        let secret = loadSecret(besideConstantsAt: url)

        let osc = json["osc"] as? [String: Any]
        let ws = osc?["webSocket"] as? [String: Any]
        let port = (ws?["port"] as? NSNumber)?.intValue ?? fallback.webSocketPort
        let reconnect = (osc?["reconnectDelay"] as? NSNumber)?.intValue ?? fallback.reconnectDelayMs

        let presence = (json["timing"] as? [String: Any])?["serverPresence"] as? [String: Any]
        let heartbeat = (presence?["heartbeatIntervalMs"] as? NSNumber)?.intValue ?? fallback.heartbeatIntervalMs
        let grace = (presence?["graceWindowMs"] as? NSNumber)?.intValue ?? fallback.graceWindowMs

        // The bridge binds on 0.0.0.0; a same-machine client connects on
        // localhost (network.localhost), same as the web UI's localhost fallback.
        let localhost = (json["network"] as? [String: Any])?["localhost"] as? String ?? fallback.host

        return AppConfig(
            host: localhost,
            webSocketPort: port,
            reconnectDelayMs: reconnect,
            heartbeatIntervalMs: heartbeat,
            graceWindowMs: grace,
            sourcePath: url.path,
            wsSecret: secret
        )
    }

    /// Read `config/.ws-secret`, or the `LOOPING_WS_SECRET` override.
    ///
    /// Same resolution order as the bridge's `utils/wsSecret.js`: env
    /// first, then the file. Unlike the bridge this never *generates*
    /// one — the bridge owns the file's lifecycle, and a client minting
    /// its own secret would simply fail the challenge in a more
    /// confusing way.
    private static func loadSecret(besideConstantsAt constantsURL: URL) -> String? {
        let env = ProcessInfo.processInfo.environment
        if let fromEnv = env["LOOPING_WS_SECRET"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !fromEnv.isEmpty {
            return fromEnv
        }
        let secretURL = constantsURL
            .deletingLastPathComponent()
            .appendingPathComponent(".ws-secret")
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
        candidates.append("/Users/Shared/DevWork/GitHub/vamp/config/constants.json")

        var dir = URL(fileURLWithPath: fm.currentDirectoryPath)
        for _ in 0..<8 {
            candidates.append(dir.appendingPathComponent("config/constants.json").path)
            dir.deleteLastPathComponent()
        }

        return candidates.first(where: { fm.fileExists(atPath: $0) }).map { URL(fileURLWithPath: $0) }
    }
}
