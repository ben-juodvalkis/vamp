import Foundation
import Network

/// The iPad's end of the link (it compiles on the Mac too, for the tests).
///
/// Two loopback listeners:
/// - `pagePort`, where the app's web view loads Vamp. Each connection the
///   page opens is parked and announced to the Mac on the control
///   connection as `OPEN <id>`.
/// - `devicePort`, which the Mac reaches through usbmux: the control
///   connection, and the stream connections that answer each `OPEN`. A
///   stream is spliced to the parked page connection with the same id.
///
/// With no Mac on the control connection, a page connection is refused at
/// once, so the web view fails fast and can say so, instead of hanging.
///
/// Anything on the iPad can reach `devicePort`, so nothing is trusted for
/// being there (ADR-494). A control connection is the Mac only once it has
/// proved it holds `key` (or paired, with the code the Mac shows, and been
/// given it); a stream only with the tag that session's key makes. Even
/// then, a second control connection replaces the first only once the first
/// has gone quiet (`LinkProtocol.healthyWithin`). Stream ids are random.
final class LinkServer {
    let devicePort: UInt16
    let pagePort: UInt16

    enum PairingEvent: Equatable {
        /// The Mac does not know this iPad yet: ask for the code it shows.
        case codeNeeded
        case wrongCode(triesLeft: Int)
        /// Paired: the Mac has the key now.
        case paired
        /// The Mac ended the pairing (too many wrong codes), or it went.
        case ended
    }

    /// Called on the main queue when the Mac's control connection comes or
    /// goes.
    var onLinkChange: ((Bool) -> Void)?
    /// Called on the main queue as a pairing goes along.
    var onPairing: ((PairingEvent) -> Void)?
    /// The link's state changes, one line each (never per message).
    var log: ((String) -> Void)?

    /// Past this with nothing heard, the link is treated as gone. A test
    /// may shorten it.
    var silenceLimit = LinkProtocol.silenceLimit

    /// One control connection: proving itself, pairing, or the link.
    private final class Session {
        let conn: NWConnection
        let macNonce: String
        let padNonce = LinkAuth.nonce()
        var buffer = LineBuffer()
        var pairing = false
        var code: String?

        init(conn: NWConnection, macNonce: String) {
            self.conn = conn
            self.macNonce = macNonce
        }
    }

    private let key: LinkKey
    private let queue = DispatchQueue(label: "vamp.link.server")
    private var linkListener: NWListener?
    private var pageListener: NWListener?
    private var control: Session?
    /// Control connections still proving themselves or pairing.
    private var handshakes: [ObjectIdentifier: Session] = [:]
    private var lastHeard = Date.distantPast
    private var silenceTimer: DispatchSourceTimer?
    private var pending: [UInt32: NWConnection] = [:]
    private var splices: [ObjectIdentifier: Splice] = [:]
    private var running = false

    init(devicePort: UInt16, pagePort: UInt16, key: LinkKey) {
        self.devicePort = devicePort
        self.pagePort = pagePort
        self.key = key
    }

    func start() {
        queue.async { [self] in
            running = true
            startListeners()
            startSilenceTimer()
        }
    }

    func stop() {
        queue.sync { [self] in
            running = false
            linkListener?.cancel(); linkListener = nil
            pageListener?.cancel(); pageListener = nil
            silenceTimer?.cancel(); silenceTimer = nil
            for session in handshakes.values { session.conn.cancel() }
            handshakes.removeAll()
            dropControl("stopped")
        }
    }

    /// iOS can tear listeners down while the app is in the background; on
    /// coming back, put back whichever is gone.
    func restartIfNeeded() {
        queue.async { [self] in
            guard running else { return }
            startListeners()
        }
    }

    /// The code the person typed, for the pairing in progress.
    func submitCode(_ code: String) {
        queue.async { [self] in
            guard let session = handshakes.values.first(where: { $0.pairing }) else { return }
            session.code = code
            let proof = LinkAuth.proof(LinkAuth.codeKey(code), "pair-ipad", session.macNonce, session.padNonce)
            session.conn.sendLine(LinkProtocol.line(.pairCode(proof: proof)))
        }
    }

    // MARK: - Listeners

    private func startListeners() {
        if linkListener == nil {
            linkListener = makeListener(port: devicePort) { [weak self] in self?.acceptLink($0) }
        }
        if pageListener == nil {
            pageListener = makeListener(port: pagePort) { [weak self] in self?.acceptPage($0) }
        }
    }

    private func makeListener(port: UInt16, accept: @escaping (NWConnection) -> Void) -> NWListener? {
        guard let listener = try? NWListener(using: .loopbackListener(port: port)) else {
            log?("could not listen on port \(port); retrying")
            retryListenersSoon()
            return nil
        }
        listener.newConnectionHandler = accept
        listener.stateUpdateHandler = { [weak self, weak listener] state in
            guard let self, let listener else { return }
            if case .failed(let error) = state {
                self.log?("listener on port \(port) failed (\(error)); retrying")
                listener.cancel()
                if self.linkListener === listener { self.linkListener = nil }
                if self.pageListener === listener { self.pageListener = nil }
                self.retryListenersSoon()
            }
        }
        listener.start(queue: queue)
        return listener
    }

    private func retryListenersSoon() {
        queue.asyncAfter(deadline: .now() + 1) { [weak self] in
            guard let self, self.running else { return }
            self.startListeners()
        }
    }

    // MARK: - The page side

    private func acceptPage(_ conn: NWConnection) {
        conn.start(queue: queue)
        guard let control else {
            conn.cancel()
            return
        }
        // Random, so a stream cannot be guessed and claimed by another app.
        var id = UInt32.random(in: 1...UInt32.max)
        while pending[id] != nil { id = UInt32.random(in: 1...UInt32.max) }
        pending[id] = conn
        control.conn.sendLine(LinkProtocol.line(.open(id)))
        queue.asyncAfter(deadline: .now() + LinkProtocol.streamWait) { [weak self] in
            if let stale = self?.pending.removeValue(forKey: id) { stale.cancel() }
        }
    }

    // MARK: - The Mac side

    private func acceptLink(_ conn: NWConnection) {
        conn.start(queue: queue)
        readHello(conn, pending: Data())
    }

    /// Read up to the first newline. The bytes after it are kept raw: on a
    /// stream they are already payload, which may not be text.
    private func readHello(_ conn: NWConnection, pending: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            var pending = pending
            if let data { pending.append(data) }
            guard let newline = pending.firstIndex(of: 0x0A) else {
                if isComplete || error != nil || pending.count > LineBuffer.maxLine { conn.cancel() }
                else { self.readHello(conn, pending: pending) }
                return
            }
            let hello = String(decoding: pending[pending.startIndex..<newline], as: UTF8.self)
            let rest = Data(pending[pending.index(after: newline)...])
            switch LinkProtocol.parseHello(hello) {
            case .control(let nonce):
                self.beginHandshake(conn, macNonce: nonce, rest: rest)
            case .stream(let id, let tag):
                self.attachStream(conn, id: id, tag: tag, leading: rest)
            case nil:
                if LinkProtocol.isOtherVersion(hello) {
                    self.log?("refused a link of another version: \(hello.split(separator: " ").prefix(3).joined(separator: " "))")
                    conn.send(content: Data(LinkProtocol.unsupportedLine().utf8), completion: .contentProcessed { _ in conn.cancel() })
                } else {
                    conn.cancel()
                }
            }
        }
    }

    private func attachStream(_ link: NWConnection, id: UInt32, tag: String, leading: Data) {
        guard let control,
              LinkAuth.same(tag, LinkAuth.streamTag(key.symmetric, macNonce: control.macNonce, padNonce: control.padNonce, id: id))
        else {
            log?("a stream without this session's tag; closed")
            link.cancel()
            return
        }
        guard let page = pending.removeValue(forKey: id) else {
            log?("a stream for an unknown or expired id; closed")
            link.cancel()
            return
        }
        let splice = Splice(link, page, queue: queue)
        let key = ObjectIdentifier(splice)
        splice.onEnd = { [weak self] in self?.splices.removeValue(forKey: key) }
        splices[key] = splice
        splice.start(leadingToB: leading)
    }

    // MARK: - The handshake

    private func beginHandshake(_ conn: NWConnection, macNonce: String, rest: Data) {
        let session = Session(conn: conn, macNonce: macNonce)
        handshakes[ObjectIdentifier(session)] = session
        conn.stateUpdateHandler = { [weak self, weak session] state in
            guard let self, let session else { return }
            switch state {
            case .failed, .cancelled: self.sessionEnded(session, why: "the connection ended")
            default: break
            }
        }
        let proof = LinkAuth.proof(key.symmetric, "ipad", macNonce, session.padNonce)
        conn.sendLine(LinkProtocol.line(.auth(keyId: key.id, nonce: session.padNonce, proof: proof)))
        // A handshake that never finishes holds nothing for long.
        queue.asyncAfter(deadline: .now() + LinkProtocol.handshakeLimit) { [weak self, weak session] in
            guard let self, let session, self.handshakes[ObjectIdentifier(session)] != nil, !session.pairing else { return }
            self.log?("a handshake did not finish; closed")
            session.conn.cancel()
        }
        if !rest.isEmpty { consume(session, rest) }
        read(session)
    }

    private func read(_ session: Session) {
        session.conn.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            if let data, !data.isEmpty { self.consume(session, data) }
            if isComplete || error != nil {
                self.sessionEnded(session, why: self.control === session ? "the Mac closed the link" : "the handshake was closed")
            } else if self.control === session || self.handshakes[ObjectIdentifier(session)] != nil {
                self.read(session)
            }
        }
    }

    private func consume(_ session: Session, _ data: Data) {
        guard let lines = session.buffer.append(data) else {
            log?("a line too long for the protocol; closed")
            session.conn.cancel()
            return
        }
        if control === session { lastHeard = Date() }
        for line in lines {
            if control === session {
                if LinkProtocol.parseControl(line) == .ping {
                    session.conn.sendLine(LinkProtocol.line(.pong))
                }
            } else if handshakes[ObjectIdentifier(session)] != nil {
                handshake(session, line)
            }
        }
    }

    private func handshake(_ session: Session, _ line: String) {
        switch LinkProtocol.parseAuth(line) {
        case .authOK(let proof):
            let expected = LinkAuth.proof(key.symmetric, "mac", session.macNonce, session.padNonce)
            guard LinkAuth.same(proof, expected) else {
                log?("a control connection failed to prove itself; closed")
                session.conn.cancel()
                return
            }
            if session.pairing {
                session.pairing = false
                notifyPairing(.paired)
            }
            adopt(session)
        case .pair:
            log?("the Mac does not know this iPad yet: pairing")
            session.pairing = true
            notifyPairing(.codeNeeded)
            queue.asyncAfter(deadline: .now() + LinkProtocol.pairingLimit) { [weak self, weak session] in
                guard let self, let session, self.handshakes[ObjectIdentifier(session)] != nil else { return }
                self.log?("the pairing timed out")
                session.conn.cancel()
            }
        case .pairWrong(let left):
            notifyPairing(.wrongCode(triesLeft: left))
        case .pairOK(let proof):
            // The other end knows the code shown on the Mac: it is the Mac.
            // Only now does the key leave this iPad.
            guard let code = session.code,
                  LinkAuth.same(proof, LinkAuth.proof(LinkAuth.codeKey(code), "pair-mac", session.macNonce, session.padNonce))
            else {
                log?("a pairing reply that does not know the code; closed")
                session.conn.cancel()
                return
            }
            session.conn.sendLine(LinkProtocol.line(.key(hex: key.hex)))
        case .denied:
            log?("the Mac refused this iPad")
            session.conn.cancel()
        default:
            break
        }
    }

    private func sessionEnded(_ session: Session, why: String) {
        if handshakes.removeValue(forKey: ObjectIdentifier(session)) != nil {
            if session.pairing { notifyPairing(.ended) }
            return
        }
        if control === session { dropControl(why) }
    }

    /// A control connection that has proved itself becomes the link, unless
    /// a working one is already there.
    private func adopt(_ session: Session) {
        handshakes.removeValue(forKey: ObjectIdentifier(session))
        if let old = control {
            guard Date().timeIntervalSince(lastHeard) > LinkProtocol.healthyWithin else {
                log?("refused a second control connection: the link is working")
                session.conn.cancel()
                return
            }
            log?("replaced a quiet control connection")
            control = nil
            old.conn.cancel()
            dropPending()
        }
        control = session
        lastHeard = Date()
        log?("linked to the Mac")
        notify(true)
    }

    private func dropControl(_ why: String) {
        guard let session = control else { return }
        log?("unlinked: \(why)")
        control = nil
        session.conn.cancel()
        dropPending()
        notify(false)
    }

    private func dropPending() {
        for (_, page) in pending { page.cancel() }
        pending.removeAll()
    }

    private func startSilenceTimer() {
        guard silenceTimer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in
            guard let self, self.control != nil else { return }
            if Date().timeIntervalSince(self.lastHeard) > self.silenceLimit {
                self.dropControl("nothing heard in \(Int(self.silenceLimit)) s")
            }
        }
        timer.resume()
        silenceTimer = timer
    }

    private func notify(_ linked: Bool) {
        let handler = onLinkChange
        DispatchQueue.main.async { handler?(linked) }
    }

    private func notifyPairing(_ event: PairingEvent) {
        let handler = onPairing
        DispatchQueue.main.async { handler?(event) }
    }
}
