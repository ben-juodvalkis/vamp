import Foundation

/// v3 OSC addresses this app speaks. These are the wire contract, not
/// configuration — they live in code exactly as they do on the web-UI side
/// (`interface/src/lib/api/handlers/v3Session.ts` +
/// `docs/reference/wire-protocol.md` §2.12). Ports/timings come from
/// `config/constants.json` (see `AppConfig`); addresses do not.
enum Wire {
    // Handshake — mirrors UI_SUPPORTED_VERSIONS in v3Handshake.ts.
    // Bridge WebSocket auth (2026-08-31). The bridge speaks first with a
    // random per-connection salt; we answer with HMAC-SHA256(secret, salt).
    // Until we do, it refuses our messages and broadcasts us nothing.
    static let authChallenge = "/bridge/auth/challenge"
    static let auth = "/bridge/auth"
    static let authResult = "/bridge/auth/result"

    static let handshakeHello = "/looping/v3/handshake/hello"
    static let handshakeAccept = "/looping/v3/handshake/accept"
    static let uiSupportedVersions = ["3.3.0"]

    // Primary SessionSettings toggles (bidirectional: same address carries
    // the write and the echo/seed — wire-protocol §2.12).
    static let autoArm = "/looping/v3/session/auto_arm"
    static let autoArmQuery = "/looping/v3/session/auto_arm/query"
    static let moveVolumeKnob = "/looping/v3/session/move_volume_knob"
    static let moveVolumeKnobQuery = "/looping/v3/session/move_volume_knob/query"
    // auto_capture: gates iPad-style auto-record + save-as-on-stop. Default
    // is launch-mode-derived on the surface (ipad→on, dev→off) then user-
    // overridable; from this app it's just another bidirectional toggle with
    // a /query seed (wire-protocol §2.12/§2.14).
    static let autoCapture = "/looping/v3/session/auto_capture"
    static let autoCaptureQuery = "/looping/v3/session/auto_capture/query"

    // Secondary transport toggle (SessionComponent pass-through to Live —
    // observed + settable, no /query, wire-protocol §2.11/§2.12).
    static let metronome = "/looping/v3/session/metronome"

    // Bridge liveness — swallowed, used only as an inbound-traffic signal.
    static let bridgePing = "/bridge/ping"
    static let bridgeBatch = "/bridge/batch"

    // Launch-mode beacon ("dev" | "ipad"), broadcast by the bridge to WS
    // clients on connect + periodically. Drives the status line.
    static let serverMode = "/bridge/server_mode"
}

/// The user-facing settings, each mapping to a set address + label.
enum Setting: CaseIterable {
    case autoArm
    case moveVolumeKnob
    case autoCapture
    case metronome

    var address: String {
        switch self {
        case .autoArm: return Wire.autoArm
        case .moveVolumeKnob: return Wire.moveVolumeKnob
        case .autoCapture: return Wire.autoCapture
        case .metronome: return Wire.metronome
        }
    }

    var label: String {
        switch self {
        case .autoArm: return "Auto-arm on selection"
        case .moveVolumeKnob: return "Move volume knob"
        case .autoCapture: return "Auto record + save-as"
        case .metronome: return "Metronome"
        }
    }
}
