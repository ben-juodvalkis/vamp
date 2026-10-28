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
final class LinkServer {
    let devicePort: UInt16
    let pagePort: UInt16

    /// Called on the main queue when the Mac's control connection comes or
    /// goes.
    var onLinkChange: ((Bool) -> Void)?

    /// The Mac pings every 2 s; past this with nothing heard, the link is
    /// treated as gone (the cable can leave a connection half-open).
    static let silenceLimit: TimeInterval = 6
    /// How long a page connection waits for the Mac's stream.
    static let streamWait: TimeInterval = 5

    private let queue = DispatchQueue(label: "vamp.link.server")
    private var linkListener: NWListener?
    private var pageListener: NWListener?
    private var control: NWConnection?
    private var controlBuffer = LineBuffer()
    private var lastHeard = Date.distantPast
    private var silenceTimer: DispatchSourceTimer?
    private var pending: [UInt32: NWConnection] = [:]
    private var splices: [ObjectIdentifier: Splice] = [:]
    private var nextId: UInt32 = 1
    private var running = false

    init(devicePort: UInt16, pagePort: UInt16) {
        self.devicePort = devicePort
        self.pagePort = pagePort
    }

    var isLinked: Bool { queue.sync { control != nil } }

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
            dropControl()
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
            retryListenersSoon()
            return nil
        }
        listener.newConnectionHandler = accept
        listener.stateUpdateHandler = { [weak self, weak listener] state in
            guard let self, let listener else { return }
            if case .failed = state {
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
        let id = nextId
        nextId &+= 1
        pending[id] = conn
        control.sendLine(LinkProtocol.line(.open(id)))
        queue.asyncAfter(deadline: .now() + Self.streamWait) { [weak self] in
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
            case .control:
                var buffer = LineBuffer()
                let early = buffer.append(rest) ?? []
                self.adoptControl(conn, buffer: buffer, earlyLines: early)
            case .stream(let id):
                self.attachStream(conn, id: id, leading: rest)
            case nil:
                conn.cancel()
            }
        }
    }

    private func attachStream(_ link: NWConnection, id: UInt32, leading: Data) {
        guard let page = pending.removeValue(forKey: id) else {
            link.cancel()
            return
        }
        let splice = Splice(link, page, queue: queue)
        let key = ObjectIdentifier(splice)
        splice.onEnd = { [weak self] in self?.splices.removeValue(forKey: key) }
        splices[key] = splice
        splice.start(leadingToB: leading)
    }

    private func adoptControl(_ conn: NWConnection, buffer: LineBuffer, earlyLines: [String]) {
        if let old = control, old !== conn { old.cancel() }
        control = conn
        controlBuffer = buffer
        lastHeard = Date()
        conn.stateUpdateHandler = { [weak self, weak conn] state in
            guard let self, let conn else { return }
            switch state {
            case .failed, .cancelled:
                if self.control === conn { self.dropControl() }
            default:
                break
            }
        }
        notify(true)
        for line in earlyLines { handleControl(line) }
        readControl(conn)
    }

    private func readControl(_ conn: NWConnection) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, isComplete, error in
            guard let self, self.control === conn else { return }
            if let data, !data.isEmpty {
                guard let lines = self.controlBuffer.append(data) else {
                    self.dropControl()
                    return
                }
                self.lastHeard = Date()
                for line in lines { self.handleControl(line) }
            }
            if isComplete || error != nil {
                self.dropControl()
            } else {
                self.readControl(conn)
            }
        }
    }

    private func handleControl(_ line: String) {
        if LinkProtocol.parseControl(line) == .ping {
            control?.sendLine(LinkProtocol.line(.pong))
        }
    }

    private func dropControl() {
        guard let conn = control else { return }
        control = nil
        controlBuffer = LineBuffer()
        conn.cancel()
        for (_, page) in pending { page.cancel() }
        pending.removeAll()
        notify(false)
    }

    private func startSilenceTimer() {
        guard silenceTimer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in
            guard let self, self.control != nil else { return }
            if Date().timeIntervalSince(self.lastHeard) > Self.silenceLimit {
                self.dropControl()
            }
        }
        timer.resume()
        silenceTimer = timer
    }

    private func notify(_ linked: Bool) {
        let handler = onLinkChange
        DispatchQueue.main.async { handler?(linked) }
    }
}
