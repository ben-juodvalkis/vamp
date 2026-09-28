import Foundation
import Combine

/// Observable model backing the menu. Holds the live toggle state and the
/// connection status, and turns menu taps into OSC writes.
///
/// Each toggle is `Bool?`: `nil` == "not yet seeded" (shown briefly on
/// connect before the surface's echo/seed lands, and while disconnected).
@MainActor
final class AppState: ObservableObject {
    @Published private(set) var connected = false
    /// Bridge launch mode ("dev" | "ipad"), or nil until the beacon arrives.
    @Published private(set) var serverMode: String?
    @Published private(set) var autoArm: Bool?
    @Published private(set) var moveVolumeKnob: Bool?
    @Published private(set) var autoCapture: Bool?
    @Published private(set) var metronome: Bool?

    let config: AppConfig
    private let client: BridgeClient

    init() {
        let cfg = AppConfig.load()
        self.config = cfg
        self.client = BridgeClient(config: cfg)

        client.onConnectionChange = { [weak self] isConnected in
            Task { @MainActor in self?.handleConnectionChange(isConnected) }
        }
        client.onMessage = { [weak self] message in
            Task { @MainActor in self?.handleMessage(message) }
        }
        client.start()
    }

    // MARK: - Reads (for the view)

    func value(for setting: Setting) -> Bool? {
        switch setting {
        case .autoArm: return autoArm
        case .moveVolumeKnob: return moveVolumeKnob
        case .autoCapture: return autoCapture
        case .metronome: return metronome
        }
    }

    // MARK: - Intents (from the view)

    /// Set a setting to an explicit value. Deliberately NOT optimistic: the
    /// checkmark only flips when the surface's echo lands (~90ms — the menu
    /// has closed by then). An optimistic flip shows a state the surface may
    /// never have received — a write sent while Live is loading a set is
    /// silently swallowed (old surface torn down, new one not up yet), and
    /// the stale checkmark then reads as "the set load reset my toggle".
    /// Echo-confirmation keeps the menu honest: a dead write leaves the
    /// checkmark unchanged.
    func set(_ setting: Setting, to on: Bool) {
        client.send(setting.address, [.int(on ? 1 : 0)])
    }

    // MARK: - Inbound

    private func handleConnectionChange(_ isConnected: Bool) {
        connected = isConnected
        if !isConnected {
            // Drop seeded values so the menu doesn't imply live state while
            // the bridge is down. They re-seed on the next handshake accept.
            serverMode = nil
            autoArm = nil
            moveVolumeKnob = nil
            autoCapture = nil
            metronome = nil
        }
    }

    private func handleMessage(_ message: OSCMessage) {
        // Launch-mode beacon carries a string, not a 0/1 flag — handle before
        // the int guard below.
        if message.address == Wire.serverMode {
            if let mode = message.args.first?.stringValue { serverMode = mode }
            return
        }

        guard let flag = message.args.first?.intValue else { return }
        let on = flag == 1
        switch message.address {
        case Wire.autoArm, Wire.autoArmQuery:
            autoArm = on
        case Wire.moveVolumeKnob, Wire.moveVolumeKnobQuery:
            moveVolumeKnob = on
        case Wire.autoCapture, Wire.autoCaptureQuery:
            autoCapture = on
        case Wire.metronome:
            metronome = on
        default:
            break
        }
    }

}
