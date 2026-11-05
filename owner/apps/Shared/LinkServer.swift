import Foundation
import Network

/// The iPad's end of the link (it compiles on the Mac too, for the tests).
///
/// Two loopback listeners, and one on Wi-Fi once it is switched on:
/// - `pagePort`, where the app's web view loads Vamp. Each connection the
///   page opens is parked and announced to the Mac on a control
///   connection as `OPEN <id>`.
/// - `devicePort`, which the Mac reaches through usbmux (the cable): the
///   control connection, and the stream connections that answer each
///   `OPEN`. A stream is spliced to the parked page connection with the
///   same id.
/// - Wi-Fi (ADR-504, `setWifi`): the same, inside TLS keyed by the pair's
///   key, on a port of the system's choosing that Bonjour advertises.
///
/// The cable and Wi-Fi each hold their own control connection. A new page
/// connection goes over the cable when it is linked, else over Wi-Fi; one
/// already open stays where it is, so plugging the cable in never cuts a
/// connection the page is using. When Wi-Fi's control connection goes, so
/// do the page connections it carried, at once, and the page reconnects
/// over the cable if it is there.
///
/// With no Mac on either, a page connection is refused at once, so the web
/// view fails fast and can say so, instead of hanging.
///
/// Anything on the iPad can reach `devicePort`, so nothing is trusted for
/// being there (ADR-494). A control connection is the Mac only once it has
/// proved it holds `key` (or paired, with the code the Mac shows, and been
/// given it); a stream only with the tag that session's key makes. Even
/// then, a second control connection replaces the first only once the first
/// has gone quiet (`LinkProtocol.healthyWithin`). Stream ids are random.
/// On Wi-Fi only a holder of the key gets through TLS at all, and a pairing
/// is refused there.
///
/// A QR pairing (ADR-505, `startPairing`) is the one way to pair without
/// the cable: a second Wi-Fi listener, for a few minutes, inside TLS keyed
/// by the one-time secret the Mac's QR code carried. Only the Mac that
/// showed the code can reach it; the pairing runs as on the cable with the
/// secret as the code, then that connection closes and the Mac links on the
/// ordinary Wi-Fi listener with the key.
final class LinkServer {
    let devicePort: UInt16
    let pagePort: UInt16

    /// How the Mac reached this iPad.
    enum Transport: Hashable {
        case cable
        case wifi
        /// A QR pairing's listener: pairs, never carries the link.
        case wifiPairing
    }

    /// Listening on Wi-Fi (ADR-504).
    struct Wifi: Equatable {
        /// Advertise with Bonjour (a test dials the port instead).
        var advertise = true
        /// Listen on this kind of interface only; nil for any (the
        /// Simulator, whose network is the Mac's, and the tests).
        var interface: NWInterface.InterfaceType? = .wifi

        init(advertise: Bool = true, interface: NWInterface.InterfaceType? = .wifi) {
            self.advertise = advertise
            self.interface = interface
        }
    }

    enum PairingEvent: Equatable {
        /// The Mac does not know this iPad yet: ask for the code it shows.
        case codeNeeded
        case wrongCode(triesLeft: Int)
        /// Paired: the Mac has the key now.
        case paired
        /// The Mac ended the pairing (too many wrong codes), or it went.
        case ended
    }

    /// Called on the main queue when the iPad becomes linked to a Mac (by
    /// either way) or stops being linked at all.
    var onLinkChange: ((Bool) -> Void)?
    /// Called on the main queue with the ways linked now, on every change.
    var onTransportsChange: ((Set<Transport>) -> Void)?
    /// Called on the main queue as a pairing goes along.
    var onPairing: ((PairingEvent) -> Void)?
    /// Called on the main queue with the Wi-Fi listener's port once it is up.
    var onWifiReady: ((UInt16) -> Void)?
    /// Called on the main queue with a QR pairing listener's port once it is up.
    var onPairingReady: ((UInt16) -> Void)?
    /// The link's state changes, one line each (never per message).
    var log: ((String) -> Void)?

    /// Past this with nothing heard, the link is treated as gone. A test
    /// may shorten it.
    var silenceLimit = LinkProtocol.silenceLimit

    /// One control connection: proving itself, pairing, or the link.
    private final class Session {
        let conn: NWConnection
        let transport: Transport
        let macNonce: String
        let padNonce = LinkAuth.nonce()
        var buffer = LineBuffer()
        var pairing = false
        var code: String?

        init(conn: NWConnection, transport: Transport, macNonce: String) {
            self.conn = conn
            self.transport = transport
            self.macNonce = macNonce
        }
    }

    private let key: LinkKey
    private let queue = DispatchQueue(label: "vamp.link.server")
    private var linkListener: NWListener?
    private var pageListener: NWListener?
    private var wifiListener: NWListener?
    private var wifi: Wifi?
    private var pairingListener: NWListener?
    /// The QR pairing under way: its secret, and a token so an old
    /// pairing's timeout does not end a newer one.
    private var pairingSecret: String?
    private var pairingToken = 0
    private var pairingInterface: NWInterface.InterfaceType?
    private var controls: [Transport: Session] = [:]
    /// Control connections still proving themselves or pairing.
    private var handshakes: [ObjectIdentifier: Session] = [:]
    private var lastHeard: [Transport: Date] = [:]
    private var silenceTimer: DispatchSourceTimer?
    /// Page connections waiting for their stream, and the way it will come.
    private var pending: [UInt32: (conn: NWConnection, transport: Transport)] = [:]
    private var splices: [ObjectIdentifier: (splice: Splice, transport: Transport)] = [:]
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
            wifiListener?.cancel(); wifiListener = nil
            pairingListener?.cancel(); pairingListener = nil
            pairingSecret = nil
            silenceTimer?.cancel(); silenceTimer = nil
            for session in handshakes.values { session.conn.cancel() }
            handshakes.removeAll()
            for transport in Array(controls.keys) { dropControl(transport, "stopped") }
        }
    }

    /// Listen on Wi-Fi as `config` says, or not at all (nil). A change
    /// starts the listener again; the cable is not touched.
    func setWifi(_ config: Wifi?) {
        queue.async { [self] in
            guard config != wifi else { return }
            wifi = config
            wifiListener?.cancel(); wifiListener = nil
            if config == nil {
                dropControl(.wifi, "Wi-Fi switched off")
            } else if running {
                startListeners()
            }
        }
    }

    /// Pair with the Mac whose QR code carried `secret` (ADR-505): listen on
    /// Wi-Fi, keyed by it, for `LinkProtocol.pairingLimit`. `onPairing` says
    /// `.paired` or `.ended`. A newer pairing replaces this one.
    func startPairing(secret: String, on network: Wifi = Wifi()) {
        queue.async { [self] in
            pairingListener?.cancel(); pairingListener = nil
            pairingSecret = secret
            pairingInterface = network.interface
            pairingToken += 1
            let token = pairingToken
            let params = NWParameters.wifiPairing(secret: secret)
            if let interface = network.interface { params.requiredInterfaceType = interface }
            var service: NWListener.Service?
            if network.advertise {
                var txt = NWTXTRecord()
                txt[LinkProtocol.txtPairingId] = LinkAuth.pairingId(secret)
                service = NWListener.Service(name: "Vamp pairing \(LinkAuth.pairingId(secret).prefix(6))",
                                             type: LinkProtocol.bonjourType, domain: nil, txtRecord: txt)
            }
            log?("pairing from a QR code: listening on Wi-Fi")
            pairingListener = makeListener(params, name: "Wi-Fi pairing", service: service, retry: false) { [weak self] in
                self?.acceptLink($0, .wifiPairing)
            }
            queue.asyncAfter(deadline: .now() + LinkProtocol.pairingLimit) { [weak self] in
                guard let self, self.pairingToken == token, self.pairingSecret != nil else { return }
                self.log?("the QR pairing timed out")
                self.endPairing(.ended)
            }
        }
    }

    /// Stop a QR pairing, telling the app how it ended.
    private func endPairing(_ event: PairingEvent) {
        pairingListener?.cancel(); pairingListener = nil
        pairingSecret = nil
        for session in handshakes.values where session.transport == .wifiPairing { session.conn.cancel() }
        notifyPairing(event)
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
            linkListener = makeListener(.loopbackListener(port: devicePort), name: "port \(devicePort)") { [weak self] in
                self?.acceptLink($0, .cable)
            }
        }
        if pageListener == nil {
            pageListener = makeListener(.loopbackListener(port: pagePort), name: "port \(pagePort)") { [weak self] in
                self?.acceptPage($0)
            }
        }
        if wifiListener == nil, let wifi {
            let params = NWParameters.wifiLink(key: key)
            if let interface = wifi.interface { params.requiredInterfaceType = interface }
            var service: NWListener.Service?
            if wifi.advertise {
                var txt = NWTXTRecord()
                txt[LinkProtocol.txtKeyId] = key.id
                // Named by the key's id, not the iPad's name: a Mac matches
                // it to a paired iPad by the TXT record either way.
                service = NWListener.Service(name: "Vamp \(key.id.prefix(6))", type: LinkProtocol.bonjourType, domain: nil, txtRecord: txt)
            }
            wifiListener = makeListener(params, name: "Wi-Fi", service: service) { [weak self] in
                self?.acceptLink($0, .wifi)
            }
        }
    }

    private func makeListener(
        _ params: NWParameters, name: String, service: NWListener.Service? = nil, retry: Bool = true,
        accept: @escaping (NWConnection) -> Void
    ) -> NWListener? {
        guard let listener = try? NWListener(using: params) else {
            log?("could not listen on \(name)\(retry ? "; retrying" : "")")
            if retry { retryListenersSoon() } else { notifyPairing(.ended) }
            return nil
        }
        listener.service = service
        listener.newConnectionHandler = accept
        listener.stateUpdateHandler = { [weak self, weak listener] state in
            guard let self, let listener else { return }
            switch state {
            case .ready:
                if self.wifiListener === listener, let port = listener.port?.rawValue {
                    self.log?("listening on Wi-Fi")
                    let handler = self.onWifiReady
                    DispatchQueue.main.async { handler?(port) }
                }
                if self.pairingListener === listener, let port = listener.port?.rawValue {
                    let handler = self.onPairingReady
                    DispatchQueue.main.async { handler?(port) }
                }
            case .failed(let error):
                self.log?("listener on \(name) failed (\(error)); retrying")
                listener.cancel()
                if self.linkListener === listener { self.linkListener = nil }
                if self.pageListener === listener { self.pageListener = nil }
                if self.wifiListener === listener { self.wifiListener = nil }
                if self.pairingListener === listener {
                    self.pairingListener = nil
                    self.pairingSecret = nil
                    self.notifyPairing(.ended)
                    return
                }
                self.retryListenersSoon()
            default:
                break
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
        // The cable when it is linked, else Wi-Fi.
        guard let control = controls[.cable] ?? controls[.wifi] else {
            conn.cancel()
            return
        }
        // Random, so a stream cannot be guessed and claimed by another app.
        var id = UInt32.random(in: 1...UInt32.max)
        while pending[id] != nil { id = UInt32.random(in: 1...UInt32.max) }
        pending[id] = (conn, control.transport)
        control.conn.sendLine(LinkProtocol.line(.open(id)))
        queue.asyncAfter(deadline: .now() + LinkProtocol.streamWait) { [weak self] in
            if let stale = self?.pending.removeValue(forKey: id) { stale.conn.cancel() }
        }
    }

    // MARK: - The Mac side

    private func acceptLink(_ conn: NWConnection, _ transport: Transport) {
        let required: NWInterface.InterfaceType?
        switch transport {
        case .cable: required = nil
        case .wifi: required = wifi?.interface
        case .wifiPairing: required = pairingInterface
        }
        guard let required else {
            conn.start(queue: queue)
            readHello(conn, transport, pending: Data())
            return
        }
        // Measured on the iPad, 2026-11-05: a listener required to use
        // Wi-Fi still took the Mac's connection over the cable's own network
        // link, so the "Wi-Fi" link died with the cable. Check the path the
        // connection actually came by, once it (and its TLS) is up.
        conn.stateUpdateHandler = { [weak self, weak conn] state in
            guard let self, let conn else { return }
            switch state {
            case .ready:
                conn.stateUpdateHandler = nil
                if conn.currentPath?.usesInterfaceType(required) == true {
                    self.readHello(conn, transport, pending: Data())
                } else {
                    self.log?("refused a connection that did not come over Wi-Fi")
                    conn.cancel()
                }
            case .failed, .cancelled:
                conn.stateUpdateHandler = nil
            default:
                break
            }
        }
        conn.start(queue: queue)
    }

    /// Read up to the first newline. The bytes after it are kept raw: on a
    /// stream they are already payload, which may not be text.
    private func readHello(_ conn: NWConnection, _ transport: Transport, pending: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            var pending = pending
            if let data { pending.append(data) }
            guard let newline = pending.firstIndex(of: 0x0A) else {
                if isComplete || error != nil || pending.count > LineBuffer.maxLine { conn.cancel() }
                else { self.readHello(conn, transport, pending: pending) }
                return
            }
            let hello = String(decoding: pending[pending.startIndex..<newline], as: UTF8.self)
            let rest = Data(pending[pending.index(after: newline)...])
            switch LinkProtocol.parseHello(hello) {
            case .control(let nonce):
                self.beginHandshake(conn, transport, macNonce: nonce, rest: rest)
            case .stream(let id, let tag):
                self.attachStream(conn, transport, id: id, tag: tag, leading: rest)
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

    private func attachStream(_ link: NWConnection, _ transport: Transport, id: UInt32, tag: String, leading: Data) {
        guard let control = controls[transport],
              LinkAuth.same(tag, LinkAuth.streamTag(key.symmetric, macNonce: control.macNonce, padNonce: control.padNonce, id: id))
        else {
            log?("a stream without this session's tag; closed")
            link.cancel()
            return
        }
        guard let page = pending[id], page.transport == transport else {
            log?("a stream for an unknown or expired id; closed")
            link.cancel()
            return
        }
        pending.removeValue(forKey: id)
        let splice = Splice(link, page.conn, queue: queue)
        let key = ObjectIdentifier(splice)
        splice.onEnd = { [weak self] in self?.splices.removeValue(forKey: key) }
        splices[key] = (splice, transport)
        splice.start(leadingToB: leading)
    }

    // MARK: - The handshake

    private func beginHandshake(_ conn: NWConnection, _ transport: Transport, macNonce: String, rest: Data) {
        let session = Session(conn: conn, transport: transport, macNonce: macNonce)
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
                self.sessionEnded(session, why: self.isControl(session) ? "the Mac closed the link" : "the handshake was closed")
            } else if self.isControl(session) || self.handshakes[ObjectIdentifier(session)] != nil {
                self.read(session)
            }
        }
    }

    private func isControl(_ session: Session) -> Bool {
        controls[session.transport] === session
    }

    private func consume(_ session: Session, _ data: Data) {
        guard let lines = session.buffer.append(data) else {
            log?("a line too long for the protocol; closed")
            session.conn.cancel()
            return
        }
        if isControl(session) { lastHeard[session.transport] = Date() }
        for line in lines {
            if isControl(session) {
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
                if session.transport == .wifiPairing {
                    // Paired from the QR code. This connection only pairs:
                    // the Mac links on the ordinary Wi-Fi listener now.
                    log?("paired from the QR code")
                    handshakes.removeValue(forKey: ObjectIdentifier(session))
                    session.conn.cancel()
                    endPairing(.paired)
                    return
                }
                notifyPairing(.paired)
            }
            guard session.transport != .wifiPairing else {
                // Already paired: a pairing connection still never links.
                session.conn.cancel()
                return
            }
            adopt(session)
        case .pair where session.transport == .wifi:
            // Only a holder of the key gets through Wi-Fi's TLS, and that
            // Mac has paired already. Pairing is the cable's, or a QR code's.
            log?("refused a pairing on the Wi-Fi link: pair by cable or QR code")
            session.conn.cancel()
        case .pair where session.transport == .wifiPairing:
            // The Mac that showed the QR code (no one else gets through its
            // TLS): the secret is the code, typed by nobody.
            guard let secret = pairingSecret else { session.conn.cancel(); return }
            log?("pairing from the QR code with the Mac")
            session.pairing = true
            session.code = secret
            let proof = LinkAuth.proof(LinkAuth.codeKey(secret), "pair-ipad", session.macNonce, session.padNonce)
            session.conn.sendLine(LinkProtocol.line(.pairCode(proof: proof)))
        case .pair:
            log?("the Mac does not know this iPad yet: pairing")
            session.pairing = true
            notifyPairing(.codeNeeded)
            queue.asyncAfter(deadline: .now() + LinkProtocol.pairingLimit) { [weak self, weak session] in
                guard let self, let session, self.handshakes[ObjectIdentifier(session)] != nil else { return }
                self.log?("the pairing timed out")
                session.conn.cancel()
            }
        case .pairWrong where session.transport == .wifiPairing:
            log?("the Mac refused the QR code's secret")
            endPairing(.ended)
        case .pairWrong(let left):
            notifyPairing(.wrongCode(triesLeft: left))
        case .pairOK(let proof):
            // The other end knows the code shown on the Mac: it is the Mac.
            // Only now does the key leave this iPad.
            guard session.transport != .wifi, let code = session.code,
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
            if session.transport == .wifiPairing { endPairing(.ended) }
        default:
            break
        }
    }

    private func sessionEnded(_ session: Session, why: String) {
        if handshakes.removeValue(forKey: ObjectIdentifier(session)) != nil {
            // A QR pairing outlives one connection: it ends by itself.
            if session.pairing && session.transport != .wifiPairing { notifyPairing(.ended) }
            return
        }
        if isControl(session) { dropControl(session.transport, why) }
    }

    /// A control connection that has proved itself becomes the link for its
    /// way (cable or Wi-Fi), unless a working one is already there.
    private func adopt(_ session: Session) {
        let transport = session.transport
        handshakes.removeValue(forKey: ObjectIdentifier(session))
        if let old = controls[transport] {
            guard Date().timeIntervalSince(lastHeard[transport] ?? .distantPast) > LinkProtocol.healthyWithin else {
                log?("refused a second control connection\(label(transport)): the link is working")
                session.conn.cancel()
                return
            }
            log?("replaced a quiet control connection\(label(transport))")
            controls[transport] = nil
            old.conn.cancel()
            dropPending(transport)
        }
        let wasLinked = !controls.isEmpty
        controls[transport] = session
        lastHeard[transport] = Date()
        log?("linked to the Mac\(label(transport))")
        notify(wasLinked: wasLinked)
    }

    private func dropControl(_ transport: Transport, _ why: String) {
        guard let session = controls[transport] else { return }
        log?("unlinked\(label(transport)): \(why)")
        controls[transport] = nil
        session.conn.cancel()
        dropPending(transport)
        // A Wi-Fi connection can linger half-open long after the network
        // has gone: end what it carried now, so the page reconnects (over
        // the cable, if it is there) instead of waiting on a dead socket.
        // The cable's go with the cable.
        if transport == .wifi {
            for entry in splices.values where entry.transport == .wifi { entry.splice.end() }
        }
        notify(wasLinked: true)
    }

    private func dropPending(_ transport: Transport) {
        for (id, page) in pending where page.transport == transport {
            page.conn.cancel()
            pending.removeValue(forKey: id)
        }
    }

    private func label(_ transport: Transport) -> String {
        switch transport {
        case .wifi, .wifiPairing: return " over Wi-Fi"
        case .cable: return wifi == nil ? "" : " by cable"
        }
    }

    private func startSilenceTimer() {
        guard silenceTimer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            for transport in Array(self.controls.keys)
            where Date().timeIntervalSince(self.lastHeard[transport] ?? .distantPast) > self.silenceLimit {
                self.dropControl(transport, "nothing heard in \(Int(self.silenceLimit)) s")
            }
        }
        timer.resume()
        silenceTimer = timer
    }

    /// Tell the app the ways linked now and, when linked turned on or off,
    /// that too.
    private func notify(wasLinked: Bool) {
        let ways = Set(controls.keys)
        let linked = !ways.isEmpty
        let onLink = onLinkChange, onWays = onTransportsChange
        DispatchQueue.main.async {
            onWays?(ways)
            if linked != wasLinked { onLink?(linked) }
        }
    }

    private func notifyPairing(_ event: PairingEvent) {
        let handler = onPairing
        DispatchQueue.main.async { handler?(event) }
    }
}
