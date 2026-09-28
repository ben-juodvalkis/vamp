import CryptoKit
import Foundation

/// WebSocket engine that talks to the Node OSC bridge, replicating the
/// lifecycle from `WebSocketConnection.ts`:
///   - connect to ws://<host>:<port>
///   - on open: send handshake hello + seed the primary toggles via /query
///   - receive loop dispatches decoded messages (unwrapping /bridge/batch)
///   - exponential-backoff reconnect (base → cap 30s), reset on open
///   - liveness watchdog: any silence > 12s force-closes so reconnect fires
///
/// All callbacks are delivered on the main thread.
final class BridgeClient: NSObject, URLSessionWebSocketDelegate {
    private let config: AppConfig
    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    /// Guards the handshake + query seeds so they fire exactly once per
    /// connection, whether triggered by an auth result or by the first
    /// ordinary frame from a bridge with auth disabled. Reset on
    /// disconnect so a reconnect seeds again.
    private var hasSeeded = false
    /// Whether this connection was challenged.
    ///
    /// The bridge sends `connection_status` and `server_mode` right
    /// behind the challenge, and answering the challenge is async — so
    /// without this the "bridge has auth disabled" fallback below fires
    /// on those frames and seeds before we are authenticated, which the
    /// bridge then refuses. Seeing a challenge means auth is required
    /// and only the auth result may seed.
    private var sawChallenge = false

    private let baseReconnectMs: Double
    private let maxReconnectMs: Double = 30_000
    private var reconnectAttempts = 0
    private var reconnectScheduled = false
    private var explicitlyStopped = false

    private var lastInbound = Date()
    private var livenessTimer: Timer?
    private let silenceThreshold: TimeInterval = 12

    private var connectedState = false

    /// Called (on main) with each inbound message, `/bridge/ping` already
    /// filtered out and `/bridge/batch` already unwrapped.
    var onMessage: ((OSCMessage) -> Void)?
    /// Called (on main) whenever the connected/disconnected state flips.
    var onConnectionChange: ((Bool) -> Void)?

    init(config: AppConfig) {
        self.config = config
        self.baseReconnectMs = Double(max(config.reconnectDelayMs, 1000))
        super.init()
        let cfg = URLSessionConfiguration.default
        cfg.waitsForConnectivity = false
        self.session = URLSession(configuration: cfg, delegate: self, delegateQueue: .main)
    }

    // MARK: - Lifecycle

    func start() {
        explicitlyStopped = false
        connect()
        startLivenessWatchdog()
    }

    func stop() {
        explicitlyStopped = true
        livenessTimer?.invalidate()
        livenessTimer = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        setConnected(false)
    }

    private func connect() {
        guard let url = URL(string: "ws://\(config.host):\(config.webSocketPort)") else { return }
        let t = session.webSocketTask(with: url)
        task = t
        t.resume()
        receive()
    }

    // MARK: - Send

    /// Send an OSC frame. Toggle writes go through here as `[.int(0|1)]`.
    func send(_ address: String, _ args: [OSCArg]) {
        guard
            let data = OSCEnvelope.encode(address, args),
            let text = String(data: data, encoding: .utf8)
        else { return }
        task?.send(.string(text)) { [weak self] error in
            guard error != nil else { return }
            DispatchQueue.main.async { self?.handleDisconnect() }
        }
    }

    // MARK: - Receive loop

    private func receive() {
        guard let t = task else { return }
        // The receive completion fires on an internal URLSession queue. Hop to
        // main so all connection state (lastInbound, reconnect bookkeeping,
        // the liveness timer) is touched from exactly one queue — no races.
        t.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self, self.task === t else { return }
                switch result {
                case .failure:
                    self.handleDisconnect()
                case .success(let message):
                    self.lastInbound = Date() // any inbound frame == liveness
                    switch message {
                    case .string(let text):
                        self.dispatch(text)
                    case .data(let d):
                        if let text = String(data: d, encoding: .utf8) { self.dispatch(text) }
                    @unknown default:
                        break
                    }
                    self.receive()
                }
            }
        }
    }

    private func dispatch(_ text: String) {
        // Already on main (see receive()); deliver synchronously.
        for msg in OSCEnvelope.decode(text) where msg.address != Wire.bridgePing {
            switch msg.address {
            case Wire.authChallenge:
                sawChallenge = true
                if case .string(let salt)? = msg.args.first, !salt.isEmpty {
                    answerAuthChallenge(salt)
                } else {
                    NSLog("[LoopingMenuBar] auth challenge carried no salt")
                }
                continue
            case Wire.authResult:
                if case .int(let ok)? = msg.args.first, ok == 1 {
                    NSLog("[LoopingMenuBar] authenticated to the bridge")
                    seedAfterAuth()
                } else {
                    NSLog("[LoopingMenuBar] bridge rejected authentication")
                }
                continue
            default:
                // A bridge with auth disabled never challenges us, so its
                // first ordinary frame is the signal that we may seed.
                // Guarded on `sawChallenge` because a bridge that *did*
                // challenge sends connection_status and server_mode right
                // behind it, and seeding on those would race our own
                // (async) answer and be refused.
                if !sawChallenge { seedAfterAuth() }
            }
            onMessage?(msg)
        }
    }

    // MARK: - URLSessionWebSocketDelegate

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        reconnectAttempts = 0
        lastInbound = Date()
        setConnected(true)

        // Deliberately no seeding here any more. Since the bridge gained
        // its auth gate, messages from an unauthenticated client are
        // refused — so a hello sent on open would be silently dropped and
        // the menu bar would sit connected-but-empty. Seeding now happens
        // in `seedAfterAuth()`, driven by the challenge exchange.
        //
        // A bridge with auth disabled never sends a challenge, so
        // `seedIfUnauthenticatedBridge()` covers that case on the first
        // inbound frame.
    }

    // MARK: - Auth

    /// Answer the bridge's HMAC challenge.
    ///
    /// The secret never crosses the wire and the salt is fresh per
    /// connection, so a captured exchange is not replayable.
    private func answerAuthChallenge(_ salt: String) {
        guard let secret = config.wsSecret, !secret.isEmpty else {
            // Nothing to prove with. The bridge will send us nothing, so
            // the menu bar shows disconnected — which is the honest
            // outcome, and better than looking connected while inert.
            NSLog("[LoopingMenuBar] no WebSocket secret available; cannot authenticate")
            return
        }
        let key = SymmetricKey(data: Data(secret.utf8))
        let mac = HMAC<SHA256>.authenticationCode(for: Data(salt.utf8), using: key)
        let hex = mac.map { String(format: "%02x", $0) }.joined()
        send(Wire.auth, [.string(hex)])
    }

    /// Send the handshake + query seeds. Called once the bridge will
    /// actually accept them.
    private func seedAfterAuth() {
        guard !hasSeeded else { return }
        hasSeeded = true

        // Handshake — the surface re-emits auto_arm + move_volume_knob on
        // accept (wire-protocol §2.12), which seeds the primary checkmarks.
        send(Wire.handshakeHello, Wire.uiSupportedVersions.map { OSCArg.string($0) })

        // Belt-and-suspenders seed: /query replies on the same address and is
        // broadcast back to WS clients even if we connected mid-session and
        // missed the accept re-emit. auto_capture also re-emits on accept, but
        // its resolved value may still be pending the first heartbeat's mode
        // seed — the /query reflects whatever the surface currently holds.
        send(Wire.autoArmQuery, [])
        send(Wire.moveVolumeKnobQuery, [])
        send(Wire.autoCaptureQuery, [])
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        handleDisconnect()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        // Covers connect-time failures (bridge down) that never open.
        if error != nil { handleDisconnect() }
    }

    // MARK: - Reconnect

    private func handleDisconnect() {
        setConnected(false)
        task = nil
        // Each connection authenticates and seeds afresh — the salt is
        // per-connection, so nothing carries over.
        hasSeeded = false
        sawChallenge = false
        guard !explicitlyStopped, !reconnectScheduled else { return }
        reconnectScheduled = true

        let delay = min(baseReconnectMs * pow(2, Double(reconnectAttempts)), maxReconnectMs)
        reconnectAttempts += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + delay / 1000.0) { [weak self] in
            guard let self else { return }
            self.reconnectScheduled = false
            if !self.explicitlyStopped { self.connect() }
        }
    }

    // MARK: - Liveness watchdog

    private func startLivenessWatchdog() {
        livenessTimer?.invalidate()
        lastInbound = Date()
        livenessTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            guard let self, self.connectedState else { return }
            if Date().timeIntervalSince(self.lastInbound) > self.silenceThreshold {
                self.task?.cancel(with: .goingAway, reason: nil)
                self.handleDisconnect()
            }
        }
    }

    // MARK: - State

    private func setConnected(_ value: Bool) {
        guard connectedState != value else { return }
        connectedState = value
        DispatchQueue.main.async { self.onConnectionChange?(value) }
    }
}
