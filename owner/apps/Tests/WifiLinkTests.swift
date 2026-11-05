import XCTest
import Network

/// The link over Wi-Fi (ADR-504), run on this Mac over loopback: the iPad's
/// Wi-Fi listener (TLS keyed by the pair's key; no Bonjour here, the tests
/// dial its port), the Mac's `LinkClient` dialling it as it dials a Bonjour
/// result, and the cable beside it as plain TCP in place of usbmux.
final class WifiLinkTests: XCTestCase {
    private let queue = DispatchQueue(label: "vamp.wifi.tests")
    private var server: LinkServer!
    private var clients: [LinkClient] = []
    private var listeners: [NWListener] = []
    private var devicePort: UInt16 = 0
    private var pagePort: UInt16 = 0
    private let key = LinkKey.random()
    private var paired: PairedIPads!
    private var pairedFile: URL!

    override func setUp() {
        super.setUp()
        devicePort = freePort()
        pagePort = freePort()
        pairedFile = FileManager.default.temporaryDirectory.appendingPathComponent("paired-\(UUID().uuidString).json")
        paired = PairedIPads(file: pairedFile)
    }

    override func tearDown() {
        clients.forEach { $0.stop() }
        server?.stop()
        listeners.forEach { $0.cancel() }
        try? FileManager.default.removeItem(at: pairedFile)
        super.tearDown()
    }

    /// Connections a stand-in page server has taken; read and written on `queue`.
    private final class Counter { var taken = 0 }

    /// The Mac's page server stand-in: echoes whatever it is sent.
    private func startEchoServer(counting counter: Counter? = nil) -> UInt16 {
        let listener = try! NWListener(using: .loopbackListener(port: freePort()))
        listener.newConnectionHandler = { conn in
            counter?.taken += 1
            conn.start(queue: self.queue)
            func echo() {
                conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, done, error in
                    if let data, !data.isEmpty {
                        conn.send(content: data, completion: .contentProcessed { _ in
                            if !done && error == nil { echo() } else { conn.cancel() }
                        })
                    } else if done || error != nil {
                        conn.cancel()
                    } else {
                        echo()
                    }
                }
            }
            echo()
        }
        let ready = expectation(description: "page server up")
        listener.stateUpdateHandler = { if case .ready = $0 { ready.fulfill() } }
        listener.start(queue: queue)
        wait(for: [ready], timeout: 3)
        listeners.append(listener)
        return listener.port!.rawValue
    }

    /// The iPad's end with Wi-Fi on, on any interface, not advertised: its
    /// Wi-Fi port.
    private func startServer() -> UInt16 {
        server = LinkServer(devicePort: devicePort, pagePort: pagePort, key: key)
        let ready = expectation(description: "listening on Wi-Fi")
        var port: UInt16 = 0
        server.onWifiReady = { port = $0; ready.fulfill() }
        server.setWifi(LinkServer.Wifi(advertise: false, interface: nil))
        server.start()
        wait(for: [ready], timeout: 5)
        return port
    }

    /// The Mac's client for the iPad on Wi-Fi, as `PadLink` makes it.
    private func wifiClient(port: UInt16, dialKey: LinkKey? = nil, macPort: UInt16) -> LinkClient {
        let tlsKey = dialKey ?? key
        let client = LinkClient(
            dial: UsbMux.networkDialer(to: .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!),
                                       using: { .wifiLink(key: tlsKey) }),
            macPort: macPort, queue: queue, paired: paired, legacyAllowed: { false }, allowPairing: false)
        clients.append(client)
        return client
    }

    private func cableClient(macPort: UInt16) -> LinkClient {
        let client = LinkClient(dial: UsbMux.loopbackDialer(port: devicePort), macPort: macPort, queue: queue, paired: paired)
        clients.append(client)
        return client
    }

    /// Wait until the iPad's end reports exactly `ways` linked.
    private func waitForWays(_ ways: Set<LinkServer.Transport>, timeout: TimeInterval = 5) {
        let reached = expectation(description: "linked: \(ways)")
        var done = false
        server.onTransportsChange = { now in
            if now == ways && !done { done = true; reached.fulfill() }
        }
        wait(for: [reached], timeout: timeout)
    }

    /// A page connection held open, as the page's WebSocket is.
    private final class PageConnection {
        let conn: NWConnection
        private var received = Data()
        private var closedAt: Date?
        private let lock = NSLock()

        init(port: UInt16, queue: DispatchQueue) {
            conn = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!, using: .linkTCP())
            conn.start(queue: queue)
            read()
        }

        private func read() {
            conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, done, error in
                guard let self else { return }
                self.lock.lock()
                if let data { self.received.append(data) }
                if done || error != nil, self.closedAt == nil { self.closedAt = Date() }
                let closed = self.closedAt != nil
                self.lock.unlock()
                if !closed { self.read() }
            }
        }

        /// Send `text` and wait for it to come back: false if it does not.
        func echo(_ text: String, timeout: TimeInterval = 5) -> Bool {
            lock.lock(); received = Data(); lock.unlock()
            conn.send(content: Data(text.utf8), completion: .contentProcessed { _ in })
            let deadline = Date().addingTimeInterval(timeout)
            while Date() < deadline {
                lock.lock(); let got = received; lock.unlock()
                if got == Data(text.utf8) { return true }
                Thread.sleep(forTimeInterval: 0.02)
            }
            return false
        }

        /// When the iPad's end closed it, if it has.
        var closed: Date? { lock.lock(); defer { lock.unlock() }; return closedAt }
    }

    // MARK: - Tests

    func testTheLinkRunsOverWifiInsideTLSKeyedByThePair() {
        paired.add(key, serial: nil)
        let port = startServer()
        let macPort = startEchoServer()
        let client = wifiClient(port: port, macPort: macPort)
        client.start()
        waitForWays([.wifi])
        let page = PageConnection(port: pagePort, queue: queue)
        XCTAssertTrue(page.echo("over Wi-Fi"))

        // Plain TCP to the Wi-Fi port, speaking the link as on the cable,
        // is never answered: it is TLS or nothing.
        let plain = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!, using: .linkTCP())
        var answered = false
        let ended = expectation(description: "plain TCP gets no link")
        ended.assertForOverFulfill = false
        plain.stateUpdateHandler = { if case .ready = $0 { plain.sendLine(LinkProtocol.line(.control(nonce: "abcd"))) } }
        plain.receive(minimumIncompleteLength: 1, maximumLength: 4096) { data, _, _, _ in
            if let data, String(decoding: data, as: UTF8.self).contains("AUTH") { answered = true }
            ended.fulfill()
        }
        plain.start(queue: queue)
        queue.asyncAfter(deadline: .now() + 1.5) { ended.fulfill() }
        wait(for: [ended], timeout: 3)
        plain.cancel()
        XCTAssertFalse(answered, "the link is never spoken outside TLS")
    }

    func testAMacWithoutTheKeyCannotReachTheIPadOverWifi() {
        let other = LinkKey.random()
        paired.add(other, serial: nil)
        let port = startServer()
        var reached = false
        server.onTransportsChange = { if $0.contains(.wifi) { reached = true } }
        let client = wifiClient(port: port, dialKey: other, macPort: startEchoServer())
        var linked = false
        client.onLinkChange = { if $0 { linked = true } }
        client.start()
        Thread.sleep(forTimeInterval: 2.5)
        XCTAssertFalse(linked)
        XCTAssertFalse(reached)
    }

    func testWifiNeverPairsFromEitherEnd() {
        // The Mac's end: the TLS key is right but the Mac has no record of
        // the iPad (say it was forgotten): denied, and no code is shown.
        let port = startServer()
        var asked = false
        server.onPairing = { if $0 == .codeNeeded { asked = true } }
        var code: String?
        let client = wifiClient(port: port, macPort: startEchoServer())
        client.onPairingCode = { if let shown = $0 { code = shown } }
        client.start()
        Thread.sleep(forTimeInterval: 1.5)
        client.stop()
        XCTAssertNil(code, "the Mac shows no code for Wi-Fi")
        XCTAssertNil(paired.key(for: key.id))

        // The iPad's end: a Mac (with the key) that asks to pair over Wi-Fi
        // is closed, and the iPad never asks for a code.
        let closed = expectation(description: "the pairing is refused")
        closed.assertForOverFulfill = false
        let raw = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!, using: .wifiLink(key: key))
        var buffer = LineBuffer()
        func read() {
            raw.receive(minimumIncompleteLength: 1, maximumLength: 4096) { data, _, done, error in
                for line in data.flatMap({ buffer.append($0) }) ?? [] where line.hasPrefix("AUTH ") {
                    raw.sendLine(LinkProtocol.line(.pair))
                }
                if done || error != nil { closed.fulfill() } else { read() }
            }
        }
        raw.stateUpdateHandler = { state in
            switch state {
            case .ready: raw.sendLine(LinkProtocol.line(.control(nonce: "abcd")))
            case .cancelled, .failed: closed.fulfill()
            default: break
            }
        }
        raw.start(queue: queue)
        read()
        wait(for: [closed], timeout: 5)
        raw.cancel()
        Thread.sleep(forTimeInterval: 0.2)
        XCTAssertFalse(asked, "the iPad asks for no code over Wi-Fi")
    }

    func testANewConnectionTakesTheCableAndAnOpenOneStaysOnWifi() {
        paired.add(key, serial: nil)
        let port = startServer()
        let overWifi = Counter(), overCable = Counter()
        let wifiMac = startEchoServer(counting: overWifi)
        let cableMac = startEchoServer(counting: overCable)

        wifiClient(port: port, macPort: wifiMac).start()
        waitForWays([.wifi])
        let held = PageConnection(port: pagePort, queue: queue)
        XCTAssertTrue(held.echo("before the cable"))

        cableClient(macPort: cableMac).start()
        waitForWays([.cable, .wifi])
        XCTAssertTrue(held.echo("after the cable"), "plugging in does not cut the open connection")
        XCTAssertNil(held.closed)

        let fresh = PageConnection(port: pagePort, queue: queue)
        XCTAssertTrue(fresh.echo("a new one"))
        queue.sync {
            XCTAssertEqual(overWifi.taken, 1, "only the first went over Wi-Fi")
            XCTAssertEqual(overCable.taken, 1, "the new one took the cable")
        }
    }

    func testWhenWifiGoesItsConnectionsEndAtOnce() {
        paired.add(key, serial: nil)
        let port = startServer()
        wifiClient(port: port, macPort: startEchoServer()).start()
        waitForWays([.wifi])
        let held = PageConnection(port: pagePort, queue: queue)
        XCTAssertTrue(held.echo("on Wi-Fi"))

        // Wi-Fi goes from the iPad's side (here: switched off; on a real
        // network, its control connection falling silent).
        let gone = Date()
        server.setWifi(nil)
        let deadline = Date().addingTimeInterval(3)
        while held.closed == nil && Date() < deadline { Thread.sleep(forTimeInterval: 0.02) }
        let closed = try! XCTUnwrap(held.closed, "the page's connection is closed, so it reconnects")
        XCTAssertLessThan(closed.timeIntervalSince(gone), 1)
    }
    // MARK: - QR pairing (ADR-505)

    /// The iPad's end with a QR pairing under way for `secret`, not
    /// advertised: the pairing listener's port.
    private func startPairing(_ secret: String) -> UInt16 {
        let ready = expectation(description: "pairing listener up")
        var port: UInt16 = 0
        server.onPairingReady = { port = $0; ready.fulfill() }
        server.startPairing(secret: secret, on: LinkServer.Wifi(advertise: false, interface: nil))
        wait(for: [ready], timeout: 5)
        return port
    }

    /// The Mac's client for a QR pairing, as `PadLink` makes it.
    private func pairingClient(port: UInt16, secret: String, macPort: UInt16) -> LinkClient {
        let client = LinkClient(
            dial: UsbMux.networkDialer(to: .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!),
                                       using: { .wifiPairing(secret: secret) }),
            macPort: macPort, queue: queue, paired: paired, legacyAllowed: { false },
            allowPairing: true, fixedCode: secret)
        clients.append(client)
        return client
    }

    func testThePairingLinkIsReadFromAScannedCode() {
        let secret = LinkAuth.newPairingSecret()
        XCTAssertEqual(LinkProtocol.pairingSecret(from: URL(string: LinkProtocol.pairingURL(secret: secret))!), secret)
        XCTAssertNil(LinkProtocol.pairingSecret(from: URL(string: "vamp://pair?s=1234")!), "too short")
        XCTAssertNil(LinkProtocol.pairingSecret(from: URL(string: "vamp://other?s=\(secret)")!))
        XCTAssertNil(LinkProtocol.pairingSecret(from: URL(string: "https://pair?s=\(secret)")!))
        XCTAssertNotEqual(LinkAuth.pairingId(secret), LinkAuth.pairingId(LinkAuth.newPairingSecret()))
    }

    func testAQRCodePairsOverWifiAndTheLinkFollows() {
        let wifiPort = startServer()
        let secret = LinkAuth.newPairingSecret()
        let pairingPort = startPairing(secret)
        var ways = Set<LinkServer.Transport>()
        server.onTransportsChange = { ways.formUnion($0) }
        let ipadPaired = expectation(description: "the iPad says paired")
        server.onPairing = { if $0 == .paired { ipadPaired.fulfill() } }
        let macPaired = expectation(description: "the Mac says paired")
        var shown: String?
        let pairer = pairingClient(port: pairingPort, secret: secret, macPort: startEchoServer())
        pairer.onPaired = { macPaired.fulfill() }
        pairer.onPairingCode = { if let code = $0 { shown = code } }
        pairer.start()
        wait(for: [ipadPaired, macPaired], timeout: 5)
        pairer.stop()
        XCTAssertEqual(paired.key(for: key.id), key, "the Mac has the iPad's key")
        XCTAssertNil(shown, "no code shown or typed")
        XCTAssertFalse(ways.contains(.wifiPairing), "the pairing connection never carried the link")

        // Then the Mac links on the ordinary Wi-Fi listener, with the key.
        wifiClient(port: wifiPort, macPort: startEchoServer()).start()
        waitForWays([.wifi])
        XCTAssertTrue(PageConnection(port: pagePort, queue: queue).echo("paired by QR"))
    }

    func testAWrongSecretCannotPair() {
        _ = startServer()
        let pairingPort = startPairing(LinkAuth.newPairingSecret())
        var paired = false
        server.onPairing = { if $0 == .paired { paired = true } }
        let guesser = pairingClient(port: pairingPort, secret: LinkAuth.newPairingSecret(), macPort: startEchoServer())
        var macPaired = false
        guesser.onPaired = { macPaired = true }
        guesser.start()
        Thread.sleep(forTimeInterval: 2)
        XCTAssertFalse(paired)
        XCTAssertFalse(macPaired)
        XCTAssertNil(self.paired.key(for: key.id))
    }

    func testAPairingConnectionNeverBecomesTheLink() {
        // A Mac that has paired already reaches the pairing listener: it
        // proves itself, and is closed, not linked there.
        paired.add(key, serial: nil)
        _ = startServer()
        let secret = LinkAuth.newPairingSecret()
        let pairingPort = startPairing(secret)
        var ways = Set<LinkServer.Transport>()
        server.onTransportsChange = { ways.formUnion($0) }
        pairingClient(port: pairingPort, secret: secret, macPort: startEchoServer()).start()
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertTrue(ways.isEmpty, "linked over: \(ways)")
        let refused = PageConnection(port: pagePort, queue: queue)
        XCTAssertFalse(refused.echo("nothing to carry it", timeout: 1))
    }
}
