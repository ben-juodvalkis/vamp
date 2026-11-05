import Foundation
import Network

/// The Mac's end of the link to one iPad.
///
/// Holds a control connection to the iPad app, pings it every
/// `LinkProtocol.pingInterval`, and for each `OPEN <id>` dials a stream,
/// says which id it answers, and splices it to the Mac's own page server —
/// the same server Safari loads from, so the app shows exactly what Safari
/// does. While the app is not answering (not open yet, or the iPad only
/// charging) it redials every second for half a minute, then every five.
///
/// Every control connection opens with the handshake (`LinkProtocol`,
/// ADR-494): the iPad proves it holds a key this Mac paired with, and the
/// Mac proves it back. An iPad it does not know is paired once, with a code
/// the menu shows (`onPairingCode`) and the person types on the iPad.
///
/// A Vamp for iPad installed before the handshake closes the connection
/// without a word. While `legacyAllowed` says so (never for an iPad that has
/// paired), the Mac then speaks version 1 to it, unauthenticated, and says
/// so (`onLegacy`); each new link tries the handshake first.
final class LinkClient {
    var onLinkChange: ((Bool) -> Void)?
    /// The iPad answered with a link version this Mac does not speak, or
    /// needs the handshake and is refused version 1.
    var onIncompatible: ((String) -> Void)?
    /// A pairing code to show while the iPad asks for one; nil when done.
    var onPairingCode: ((String?) -> Void)?
    /// Whether the link up now is version 1, unauthenticated.
    var onLegacy: ((Bool) -> Void)?
    /// The link's state changes, one line each (never per message).
    var log: ((String) -> Void)?

    static let redialDelay: TimeInterval = 1
    static let slowRedialDelay: TimeInterval = 5
    static let fastRedialFor: TimeInterval = 30

    private enum Phase {
        case idle
        /// Handshake sent; waiting for the iPad's AUTH.
        case proving(macNonce: String)
        /// The iPad is unknown: a code is shown, its proof awaited.
        case pairing(macNonce: String, padNonce: String, keyId: String, code: String, triesLeft: Int)
        /// The code was right: the iPad's key is awaited.
        case awaitingKey(macNonce: String, padNonce: String, keyId: String)
        case linked(key: LinkKey, macNonce: String, padNonce: String)
        case legacy
    }

    private let dial: LinkDialer
    private let macHost: NWEndpoint.Host
    private let macPort: NWEndpoint.Port
    private let queue: DispatchQueue
    private let paired: PairedIPads
    private let serial: String?
    private let legacyAllowed: () -> Bool
    /// False over Wi-Fi (ADR-504): an iPad this Mac has not paired with is
    /// denied, never shown a code. Pairing is the cable's alone.
    private let allowPairing: Bool
    /// Over Wi-Fi another Mac may hold the iPad: a link the iPad drops
    /// within a few seconds of coming up redials slowly, not every second.
    var slowAfterShortLink = false
    private var control: NWConnection?
    private var phase = Phase.idle
    private var heardAny = false
    /// The next dial speaks version 1 (the last handshake was closed unanswered).
    private var tryLegacy = false
    private var controlBuffer = LineBuffer()
    private var lastPong = Date.distantPast
    private var pingTimer: DispatchSourceTimer?
    private var splices: [ObjectIdentifier: Splice] = [:]
    private var running = false
    private var dialing = false
    /// When the link was last up, or the client started: the fast redial
    /// runs for `fastRedialFor` after it.
    private var lastUp = Date()
    /// Said once per stretch of the app not answering, not on every redial.
    private var saidNotAnswering = false

    init(
        dial: @escaping LinkDialer, macHost: String = "127.0.0.1", macPort: UInt16, queue: DispatchQueue,
        paired: PairedIPads, serial: String? = nil, legacyAllowed: @escaping () -> Bool = { true },
        allowPairing: Bool = true
    ) {
        self.dial = dial
        self.macHost = NWEndpoint.Host(macHost)
        self.macPort = NWEndpoint.Port(rawValue: macPort)!
        self.queue = queue
        self.paired = paired
        self.serial = serial
        self.legacyAllowed = legacyAllowed
        self.allowPairing = allowPairing
    }

    func start() {
        queue.async { [self] in
            guard !running else { return }
            running = true
            lastUp = Date()
            dialControl()
            startPingTimer()
        }
    }

    func stop() {
        queue.async { [self] in
            running = false
            pingTimer?.cancel(); pingTimer = nil
            dropControl(redial: false)
            for splice in splices.values { splice.end() }
        }
    }

    // MARK: - Control

    private func dialControl() {
        guard running, control == nil, !dialing else { return }
        dialing = true
        dial(queue) { [weak self] conn, rest in
            guard let self else { conn?.cancel(); return }
            self.dialing = false
            guard self.running, let conn else {
                conn?.cancel()
                if !self.saidNotAnswering {
                    self.saidNotAnswering = true
                    self.log?("the iPad app is not answering; redialling")
                }
                self.redialSoon()
                return
            }
            self.saidNotAnswering = false
            self.adoptControl(conn, early: rest)
        }
    }

    private func redialSoon(now: Bool = false) {
        let fast = Date().timeIntervalSince(lastUp) < Self.fastRedialFor
        let delay = now ? 0.05 : (fast ? Self.redialDelay : Self.slowRedialDelay)
        queue.asyncAfter(deadline: .now() + delay) { [weak self] in self?.dialControl() }
    }

    private func adoptControl(_ conn: NWConnection, early: Data) {
        control = conn
        controlBuffer = LineBuffer()
        heardAny = false
        conn.stateUpdateHandler = { [weak self, weak conn] state in
            guard let self, let conn, self.control === conn else { return }
            if case .failed = state { self.dropControl(redial: true, why: "the connection failed") }
        }
        if tryLegacy {
            tryLegacy = false
            guard legacyAllowed() else {
                log?("this iPad has paired before: refusing the unauthenticated link")
                onIncompatible?("needs the authenticated link")
                lastUp = .distantPast
                dropControl(redial: true, why: "refused version 1")
                return
            }
            conn.sendLine(LinkProtocol.legacyControlLine())
            phase = .legacy
            linkUp(legacy: true)
        } else {
            let nonce = LinkAuth.nonce()
            phase = .proving(macNonce: nonce)
            conn.sendLine(LinkProtocol.line(.control(nonce: nonce)))
            queue.asyncAfter(deadline: .now() + LinkProtocol.handshakeLimit) { [weak self, weak conn] in
                guard let self, let conn, self.control === conn, case .proving = self.phase else { return }
                self.dropControl(redial: true, why: "the handshake did not finish")
            }
        }
        if !early.isEmpty { consume(early) }
        readControl(conn)
    }

    private func linkUp(legacy: Bool) {
        lastUp = Date()
        lastPong = Date()
        log?(legacy ? "linked to the iPad, unauthenticated (an older Vamp for iPad: update it)" : "linked to the iPad")
        onLegacy?(legacy)
        notify(true)
    }

    private func readControl(_ conn: NWConnection) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, isComplete, error in
            guard let self, self.control === conn else { return }
            if let data, !data.isEmpty { self.consume(data) }
            if self.control !== conn { return }
            if isComplete || error != nil {
                if case .proving = self.phase, !self.heardAny {
                    // Closed without a word: a Vamp for iPad from before the
                    // handshake. Speak its version next, if allowed.
                    self.tryLegacy = true
                    self.dropControl(redial: true, why: "the iPad closed the handshake unanswered", now: true)
                } else {
                    self.dropControl(redial: true, why: "the iPad closed the link")
                }
            } else {
                self.readControl(conn)
            }
        }
    }

    private func consume(_ data: Data) {
        heardAny = true
        guard let lines = controlBuffer.append(data) else {
            dropControl(redial: true, why: "a line too long for the protocol")
            return
        }
        for line in lines where control != nil {
            if line.hasPrefix(LinkProtocol.unsupported) {
                log?("the iPad app speaks another link version (\(line)); update Vamp for iPad")
                onIncompatible?(line)
                // Slow redials from here: it will not change until it is updated.
                lastUp = .distantPast
                dropControl(redial: true, why: "versions differ")
                return
            }
            switch phase {
            case .linked, .legacy:
                switch LinkProtocol.parseControl(line) {
                case .open(let id): openStream(id)
                case .pong: lastPong = Date()
                case .ping, nil: break
                }
            default:
                handshake(line)
            }
        }
    }

    private func handshake(_ line: String) {
        guard let control, let message = LinkProtocol.parseAuth(line) else { return }
        switch (phase, message) {
        case (.proving(let macNonce), .auth(let keyId, let padNonce, let proof)):
            if let key = paired.key(for: keyId) {
                guard LinkAuth.same(proof, LinkAuth.proof(key.symmetric, "ipad", macNonce, padNonce)) else {
                    deny("the iPad failed to prove its key")
                    return
                }
                control.sendLine(LinkProtocol.line(.authOK(proof: LinkAuth.proof(key.symmetric, "mac", macNonce, padNonce))))
                phase = .linked(key: key, macNonce: macNonce, padNonce: padNonce)
                linkUp(legacy: false)
            } else if !allowPairing {
                deny("an iPad this Mac has not paired with (pair it by cable)")
            } else {
                let code = LinkAuth.newCode()
                phase = .pairing(macNonce: macNonce, padNonce: padNonce, keyId: keyId, code: code, triesLeft: LinkProtocol.pairingTries)
                log?("an iPad this Mac does not know: pairing (the code is in the menu)")
                onPairingCode?(code)
                control.sendLine(LinkProtocol.line(.pair))
            }
        case (.pairing(let macNonce, let padNonce, let keyId, let code, let triesLeft), .pairCode(let proof)):
            let codeKey = LinkAuth.codeKey(code)
            if LinkAuth.same(proof, LinkAuth.proof(codeKey, "pair-ipad", macNonce, padNonce)) {
                phase = .awaitingKey(macNonce: macNonce, padNonce: padNonce, keyId: keyId)
                control.sendLine(LinkProtocol.line(.pairOK(proof: LinkAuth.proof(codeKey, "pair-mac", macNonce, padNonce))))
            } else if triesLeft > 1 {
                phase = .pairing(macNonce: macNonce, padNonce: padNonce, keyId: keyId, code: code, triesLeft: triesLeft - 1)
                control.sendLine(LinkProtocol.line(.pairWrong(triesLeft: triesLeft - 1)))
            } else {
                deny("too many wrong pairing codes")
            }
        case (.awaitingKey(let macNonce, let padNonce, let keyId), .key(let hex)):
            guard let key = LinkKey(hex: hex), key.id == keyId else {
                deny("the iPad sent a key that is not the one it named")
                return
            }
            paired.add(key, serial: serial)
            log?("paired with the iPad")
            onPairingCode?(nil)
            control.sendLine(LinkProtocol.line(.authOK(proof: LinkAuth.proof(key.symmetric, "mac", macNonce, padNonce))))
            phase = .linked(key: key, macNonce: macNonce, padNonce: padNonce)
            linkUp(legacy: false)
        default:
            deny("a handshake message out of turn")
        }
    }

    /// Say DENIED, then close once it has gone out (closing at once can
    /// cut it off), and redial slowly.
    private func deny(_ why: String) {
        guard let conn = control else { return }
        lastUp = .distantPast
        dropControl(redial: true, why: why, closeNow: false)
        conn.send(content: Data(LinkProtocol.line(.denied).utf8), completion: .contentProcessed { _ in conn.cancel() })
    }

    private func dropControl(redial: Bool, why: String = "stopped", now: Bool = false, closeNow: Bool = true) {
        guard let conn = control else { return }
        let wasUp: Bool
        switch phase {
        case .linked, .legacy: wasUp = true
        case .pairing, .awaitingKey:
            wasUp = false
            onPairingCode?(nil)
        default: wasUp = false
        }
        control = nil
        phase = .idle
        if closeNow { conn.cancel() }
        if wasUp && slowAfterShortLink && Date().timeIntervalSince(lastUp) < LinkProtocol.healthyWithin {
            lastUp = .distantPast
        }
        if wasUp {
            log?("unlinked: \(why)")
            notify(false)
        } else if why != "stopped" {
            log?("no link: \(why)")
        }
        if redial { redialSoon(now: now) }
    }

    private func startPingTimer() {
        guard pingTimer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + LinkProtocol.pingInterval, repeating: LinkProtocol.pingInterval)
        timer.setEventHandler { [weak self] in
            guard let self, let control = self.control else { return }
            switch self.phase {
            case .linked, .legacy: break
            default: return
            }
            if Date().timeIntervalSince(self.lastPong) > LinkProtocol.pongLimit {
                self.dropControl(redial: true, why: "no answer in \(Int(LinkProtocol.pongLimit)) s")
            } else {
                control.sendLine(LinkProtocol.line(.ping))
            }
        }
        timer.resume()
        pingTimer = timer
    }

    // MARK: - Streams

    private func openStream(_ id: UInt32) {
        let hello: String
        switch phase {
        case .linked(let key, let macNonce, let padNonce):
            hello = LinkProtocol.line(.stream(id: id, tag: LinkAuth.streamTag(key.symmetric, macNonce: macNonce, padNonce: padNonce, id: id)))
        case .legacy:
            hello = LinkProtocol.legacyStreamLine(id)
        default:
            return
        }
        dial(queue) { [weak self] device, rest in
            guard let self, self.running, let device else { device?.cancel(); return }
            device.sendLine(hello)
            let mac = NWConnection(host: self.macHost, port: self.macPort, using: .linkTCP())
            mac.start(queue: self.queue)
            let splice = Splice(device, mac, queue: self.queue)
            let key = ObjectIdentifier(splice)
            splice.onEnd = { [weak self] in self?.splices.removeValue(forKey: key) }
            self.splices[key] = splice
            mac.stateUpdateHandler = { state in
                if case .failed = state { splice.end() }
            }
            splice.start(leadingToB: rest)
        }
    }

    private func notify(_ linked: Bool) {
        let handler = onLinkChange
        DispatchQueue.main.async { handler?(linked) }
    }
}
