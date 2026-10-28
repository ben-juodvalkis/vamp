import XCTest
import Network

/// The protocol pieces, then the whole link run on this Mac: the iPad's
/// `LinkServer` and the Mac's `LinkClient` joined by plain TCP in place of
/// usbmux, with a stand-in for the Mac's page server behind it.
final class LinkProtocolTests: XCTestCase {
    func testHelloRoundTrip() {
        XCTAssertEqual(LinkProtocol.parseHello("VAMPLINK 1 CONTROL"), .control)
        XCTAssertEqual(LinkProtocol.parseHello("VAMPLINK 1 STREAM 42"), .stream(42))
        XCTAssertEqual(LinkProtocol.line(.stream(42)), "VAMPLINK 1 STREAM 42\n")
        XCTAssertNil(LinkProtocol.parseHello("VAMPLINK 2 CONTROL"))
        XCTAssertNil(LinkProtocol.parseHello("GET / HTTP/1.1"))
        XCTAssertNil(LinkProtocol.parseHello("VAMPLINK 1 STREAM x"))
    }

    func testControlRoundTrip() {
        for message: LinkProtocol.Control in [.open(7), .ping, .pong] {
            let line = LinkProtocol.line(message)
            XCTAssertEqual(LinkProtocol.parseControl(String(line.dropLast())), message)
        }
        XCTAssertNil(LinkProtocol.parseControl("OPEN"))
    }

    func testLineBufferKeepsTheRemainder() {
        var buffer = LineBuffer()
        XCTAssertEqual(buffer.append(Data("PI".utf8)), [])
        XCTAssertEqual(buffer.append(Data("NG\nOPEN 3\nPAR".utf8)), ["PING", "OPEN 3"])
        XCTAssertEqual(buffer.takeRemainder(), Data("PAR".utf8))
        XCTAssertNil(buffer.append(Data(repeating: 0x41, count: LineBuffer.maxLine + 1)))
    }

    func testUsbMuxPacketRoundTrip() {
        let packet = UsbMux.packet(["MessageType": "Connect", "DeviceID": 12, "PortNumber": UsbMux.wirePort(62078)], tag: 3)
        let parsed = UsbMux.parsePacket(packet + Data([1, 2, 3]))
        XCTAssertEqual(parsed?.length, packet.count)
        XCTAssertEqual(parsed?.message["MessageType"] as? String, "Connect")
        XCTAssertEqual(parsed?.message["DeviceID"] as? Int, 12)
        // usbmuxd reads the port as network byte order: 62078 = 0xF27E.
        XCTAssertEqual(parsed?.message["PortNumber"] as? Int, 0x7EF2)
        XCTAssertNil(UsbMux.parsePacket(packet.dropLast()))
    }
}

final class LinkEndToEndTests: XCTestCase {
    private let queue = DispatchQueue(label: "vamp.link.tests")
    private var server: LinkServer!
    private var client: LinkClient?
    private var macServer: NWListener!
    private var devicePort: UInt16 = 0
    private var pagePort: UInt16 = 0

    override func setUp() {
        super.setUp()
        devicePort = UInt16.random(in: 40000...44999)
        pagePort = UInt16.random(in: 45000...49999)
    }

    override func tearDown() {
        client?.stop()
        server?.stop()
        macServer?.cancel()
        super.tearDown()
    }

    /// The Mac's page server stand-in: echoes whatever it is sent.
    private func startEchoServer() -> UInt16 {
        let listener = try! NWListener(using: .loopbackListener(port: UInt16.random(in: 50000...54999)))
        listener.newConnectionHandler = { conn in
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
        let ready = expectation(description: "mac server up")
        listener.stateUpdateHandler = { if case .ready = $0 { ready.fulfill() } }
        listener.start(queue: queue)
        wait(for: [ready], timeout: 3)
        macServer = listener
        return listener.port!.rawValue
    }

    /// Plain TCP to the iPad side, where usbmux would be on the rig.
    private func tcpDialer(_ port: UInt16) -> LinkDialer {
        return { queue, done in
            let conn = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!, using: .linkTCP())
            var finished = false
            conn.stateUpdateHandler = { state in
                guard !finished else { return }
                switch state {
                case .ready: finished = true; done(conn, Data())
                case .failed, .waiting: finished = true; conn.cancel(); done(nil, Data())
                default: break
                }
            }
            conn.start(queue: queue)
        }
    }

    private func startLink(macPort: UInt16) {
        server = LinkServer(devicePort: devicePort, pagePort: pagePort)
        let linked = expectation(description: "linked")
        var fulfilled = false
        server.onLinkChange = { up in
            if up && !fulfilled { fulfilled = true; linked.fulfill() }
        }
        server.start()
        client = LinkClient(dial: tcpDialer(devicePort), macPort: macPort, queue: queue)
        client!.start()
        wait(for: [linked], timeout: 5)
    }

    /// Send `payload` on a fresh page connection and collect what comes back.
    private func roundTrip(_ payload: Data, timeout: TimeInterval = 5) -> Data {
        let conn = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: pagePort)!, using: .linkTCP())
        var received = Data()
        let done = expectation(description: "echoed")
        func read() {
            conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, isComplete, error in
                if let data { received.append(data) }
                if received.count >= payload.count { done.fulfill(); return }
                if isComplete || error != nil { done.fulfill(); return }
                read()
            }
        }
        conn.start(queue: queue)
        conn.send(content: payload, completion: .contentProcessed { _ in })
        read()
        wait(for: [done], timeout: timeout)
        conn.cancel()
        return received
    }

    func testBytesCrossTheLinkBothWays() {
        startLink(macPort: startEchoServer())
        XCTAssertEqual(roundTrip(Data("GET / HTTP/1.1\r\n\r\n".utf8)), Data("GET / HTTP/1.1\r\n\r\n".utf8))
    }

    func testBinaryAndLargePayloadsArriveIntact() {
        startLink(macPort: startEchoServer())
        var bytes = Data(count: 2_000_000)
        bytes.withUnsafeMutableBytes { raw in
            for i in 0..<raw.count { raw[i] = UInt8(truncatingIfNeeded: i &* 31) }
        }
        XCTAssertEqual(roundTrip(bytes, timeout: 15), bytes)
    }

    func testManyConnectionsAtOnce() {
        startLink(macPort: startEchoServer())
        let group = DispatchGroup()
        var results = [Int: Data]()
        let lock = NSLock()
        for i in 0..<20 {
            group.enter()
            DispatchQueue.global().async {
                let conn = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: self.pagePort)!, using: .linkTCP())
                let q = DispatchQueue(label: "c\(i)")
                let payload = Data("conn-\(i)\n".utf8)
                var got = Data()
                func read() {
                    conn.receive(minimumIncompleteLength: 1, maximumLength: 1024) { data, _, done, error in
                        if let data { got.append(data) }
                        if got.count >= payload.count || done || error != nil {
                            lock.lock(); results[i] = got; lock.unlock()
                            conn.cancel()
                            group.leave()
                        } else { read() }
                    }
                }
                conn.start(queue: q)
                conn.send(content: payload, completion: .contentProcessed { _ in })
                read()
            }
        }
        XCTAssertEqual(group.wait(timeout: .now() + 10), .success)
        for i in 0..<20 { XCTAssertEqual(results[i], Data("conn-\(i)\n".utf8), "connection \(i)") }
    }

    func testAPageConnectionWithNoMacIsRefusedAtOnce() {
        server = LinkServer(devicePort: devicePort, pagePort: pagePort)
        server.start()
        Thread.sleep(forTimeInterval: 0.3)
        let started = Date()
        let got = roundTrip(Data("hello".utf8), timeout: 3)
        XCTAssertTrue(got.isEmpty)
        XCTAssertLessThan(Date().timeIntervalSince(started), 1.5, "refused at once, not left hanging")
    }

    func testTheLinkComesBackAfterTheMacGoes() {
        let macPort = startEchoServer()
        startLink(macPort: macPort)

        let down = expectation(description: "unlinked")
        let up = expectation(description: "relinked")
        var sawDown = false
        server.onLinkChange = { linked in
            if !linked && !sawDown { sawDown = true; down.fulfill() }
            if linked && sawDown { up.fulfill() }
        }
        client!.stop()
        wait(for: [down], timeout: 3)

        let started = Date()
        client = LinkClient(dial: tcpDialer(devicePort), macPort: macPort, queue: queue)
        client!.start()
        wait(for: [up], timeout: 5)
        XCTAssertLessThan(Date().timeIntervalSince(started), 2)
        XCTAssertEqual(roundTrip(Data("again".utf8)), Data("again".utf8))
    }
}
