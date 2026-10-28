import Foundation
import Network

/// The Mac's end of the link to one iPad.
///
/// Holds a control connection to the iPad app (redialled every second while
/// it is down: the app may not be open yet), pings it every 2 s, and for
/// each `OPEN <id>` dials a stream, says which id it answers, and splices it
/// to the Mac's own page server — the same server Safari loads from, so the
/// app shows exactly what Safari does.
final class LinkClient {
    var onLinkChange: ((Bool) -> Void)?

    static let pingInterval: TimeInterval = 2
    static let pongLimit: TimeInterval = 6
    static let redialDelay: TimeInterval = 1

    private let dial: LinkDialer
    private let macHost: NWEndpoint.Host
    private let macPort: NWEndpoint.Port
    private let queue: DispatchQueue
    private var control: NWConnection?
    private var controlBuffer = LineBuffer()
    private var lastPong = Date.distantPast
    private var pingTimer: DispatchSourceTimer?
    private var splices: [ObjectIdentifier: Splice] = [:]
    private var running = false
    private var dialing = false

    init(dial: @escaping LinkDialer, macHost: String = "127.0.0.1", macPort: UInt16, queue: DispatchQueue) {
        self.dial = dial
        self.macHost = NWEndpoint.Host(macHost)
        self.macPort = NWEndpoint.Port(rawValue: macPort)!
        self.queue = queue
    }

    func start() {
        queue.async { [self] in
            guard !running else { return }
            running = true
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
                self.redialSoon()
                return
            }
            self.adoptControl(conn, early: rest)
        }
    }

    private func redialSoon() {
        queue.asyncAfter(deadline: .now() + Self.redialDelay) { [weak self] in self?.dialControl() }
    }

    private func adoptControl(_ conn: NWConnection, early: Data) {
        control = conn
        controlBuffer = LineBuffer()
        lastPong = Date()
        conn.stateUpdateHandler = { [weak self, weak conn] state in
            guard let self, let conn, self.control === conn else { return }
            if case .failed = state { self.dropControl(redial: true) }
        }
        conn.sendLine(LinkProtocol.line(.control))
        notify(true)
        if !early.isEmpty { consume(early) }
        readControl(conn)
    }

    private func readControl(_ conn: NWConnection) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, isComplete, error in
            guard let self, self.control === conn else { return }
            if let data, !data.isEmpty { self.consume(data) }
            if self.control !== conn { return }
            if isComplete || error != nil {
                self.dropControl(redial: true)
            } else {
                self.readControl(conn)
            }
        }
    }

    private func consume(_ data: Data) {
        guard let lines = controlBuffer.append(data) else {
            dropControl(redial: true)
            return
        }
        for line in lines {
            switch LinkProtocol.parseControl(line) {
            case .open(let id): openStream(id)
            case .pong: lastPong = Date()
            case .ping: control?.sendLine(LinkProtocol.line(.pong))
            case nil: break
            }
        }
    }

    private func dropControl(redial: Bool) {
        guard let conn = control else { return }
        control = nil
        conn.cancel()
        notify(false)
        if redial { redialSoon() }
    }

    private func startPingTimer() {
        guard pingTimer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + Self.pingInterval, repeating: Self.pingInterval)
        timer.setEventHandler { [weak self] in
            guard let self, let control = self.control else { return }
            if Date().timeIntervalSince(self.lastPong) > Self.pongLimit {
                self.dropControl(redial: true)
            } else {
                control.sendLine(LinkProtocol.line(.ping))
            }
        }
        timer.resume()
        pingTimer = timer
    }

    // MARK: - Streams

    private func openStream(_ id: UInt32) {
        dial(queue) { [weak self] device, rest in
            guard let self, self.running, let device else { device?.cancel(); return }
            device.sendLine(LinkProtocol.line(.stream(id)))
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
