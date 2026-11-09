import XCTest
import Network
import Darwin

/// A loopback port nothing is listening on right now: the kernel's pick,
/// so two tests (or a running Simulator app) never collide on one.
func freePort() -> UInt16 {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    defer { close(fd) }
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    addr.sin_port = 0
    var len = socklen_t(MemoryLayout<sockaddr_in>.size)
    _ = withUnsafeMutablePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, len) } }
    _ = withUnsafeMutablePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &len) } }
    return UInt16(bigEndian: addr.sin_port)
}

/// The protocol pieces, then the whole link run on this Mac: the iPad's
/// `LinkServer` and the Mac's `LinkClient` joined by plain TCP in place of
/// usbmux, with a stand-in for the Mac's page server behind it.
final class LinkProtocolTests: XCTestCase {
    func testHelloRoundTrip() {
        XCTAssertEqual(LinkProtocol.parseHello("VAMPLINK 2 CONTROL 0a1b"), .control(nonce: "0a1b"))
        XCTAssertEqual(LinkProtocol.parseHello("VAMPLINK 2 STREAM 42 beef"), .stream(id: 42, tag: "beef"))
        XCTAssertEqual(LinkProtocol.line(.stream(id: 42, tag: "beef")), "VAMPLINK 2 STREAM 42 beef\n")
        // Version 1, and a version 2 hello without its nonce or tag, are not hellos.
        XCTAssertNil(LinkProtocol.parseHello("VAMPLINK 1 CONTROL"))
        XCTAssertNil(LinkProtocol.parseHello("VAMPLINK 2 CONTROL"))
        XCTAssertNil(LinkProtocol.parseHello("VAMPLINK 2 STREAM 42"))
        XCTAssertNil(LinkProtocol.parseHello("VAMPLINK 2 CONTROL not-hex"))
        XCTAssertTrue(LinkProtocol.isOtherVersion("VAMPLINK 1 CONTROL"))
        XCTAssertFalse(LinkProtocol.isOtherVersion("VAMPLINK 2 CONTROL abc"))
        XCTAssertFalse(LinkProtocol.isOtherVersion("GET / HTTP/1.1"))
        XCTAssertNil(LinkProtocol.parseHello("GET / HTTP/1.1"))
        XCTAssertEqual(LinkProtocol.legacyControlLine(), "VAMPLINK 1 CONTROL\n")
    }

    func testAuthRoundTrip() {
        let messages: [LinkProtocol.Auth] = [
            .auth(keyId: "ab12", nonce: "cd34", proof: "ef56"), .authOK(proof: "aa"), .pair,
            .pairCode(proof: "bb"), .pairOK(proof: "cc"), .pairWrong(triesLeft: 3), .key(hex: "dd"), .denied
        ]
        for message in messages {
            XCTAssertEqual(LinkProtocol.parseAuth(String(LinkProtocol.line(message).dropLast())), message)
        }
        XCTAssertNil(LinkProtocol.parseAuth("AUTH a b"))
        XCTAssertNil(LinkProtocol.parseAuth("KEY not hex at all"))
    }

    func testProofsAreBoundToTheirRoleAndSession() {
        let key = LinkKey.random().symmetric
        let ipad = LinkAuth.proof(key, "ipad", "m1", "p1")
        XCTAssertEqual(ipad, LinkAuth.proof(key, "ipad", "m1", "p1"))
        XCTAssertNotEqual(ipad, LinkAuth.proof(key, "mac", "m1", "p1"), "the iPad's proof is not the Mac's")
        XCTAssertNotEqual(ipad, LinkAuth.proof(key, "ipad", "m2", "p1"), "nor good in another session")
        XCTAssertNotEqual(ipad, LinkAuth.proof(LinkKey.random().symmetric, "ipad", "m1", "p1"))
        XCTAssertTrue(LinkAuth.same("abc", "abc"))
        XCTAssertFalse(LinkAuth.same("abc", "abd"))
        let k = LinkKey.random()
        XCTAssertEqual(LinkKey(hex: k.hex), k)
        XCTAssertEqual(k.id.count, 16)
        XCTAssertTrue(LinkAuth.newCode().allSatisfy(\.isNumber))
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
    /// The iPad's key, and the Mac's store of paired iPads (in a scratch file).
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
        client?.stop()
        server?.stop()
        macServer?.cancel()
        try? FileManager.default.removeItem(at: pairedFile)
        super.tearDown()
    }

    private func makeClient(macPort: UInt16, serial: String? = nil, legacyAllowed: @escaping () -> Bool = { true }) -> LinkClient {
        LinkClient(dial: UsbMux.loopbackDialer(port: devicePort), macPort: macPort, queue: queue,
                   paired: paired, serial: serial, legacyAllowed: legacyAllowed)
    }

    /// The Mac's page server stand-in: echoes whatever it is sent.
    private func startEchoServer() -> UInt16 {
        let listener = try! NWListener(using: .loopbackListener(port: freePort()))
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

    /// The iPad and the Mac, already paired, linked.
    private func startLink(macPort: UInt16) {
        paired.add(key, serial: nil)
        server = LinkServer(devicePort: devicePort, pagePort: pagePort, key: key)
        let linked = expectation(description: "linked")
        var fulfilled = false
        server.onLinkChange = { up in
            if up && !fulfilled { fulfilled = true; linked.fulfill() }
        }
        server.start()
        client = makeClient(macPort: macPort)
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
        server = LinkServer(devicePort: devicePort, pagePort: pagePort, key: key)
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
        client = makeClient(macPort: macPort)
        client!.start()
        wait(for: [up], timeout: 5)
        XCTAssertLessThan(Date().timeIntervalSince(started), 2)
        XCTAssertEqual(roundTrip(Data("again".utf8)), Data("again".utf8))
    }

    // MARK: - A raw stand-in for the Mac, or for another app on the iPad

    /// A connection to the iPad's link port that sends `hello` and hands
    /// back each line it is sent.
    private func rawLink(_ hello: String, lines: @escaping (String) -> Void, closed: (() -> Void)? = nil) -> NWConnection {
        let conn = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: devicePort)!, using: .linkTCP())
        var buffer = LineBuffer()
        var saidClosed = false
        let close = { if !saidClosed { saidClosed = true; closed?() } }
        func read() {
            conn.receive(minimumIncompleteLength: 1, maximumLength: 4096) { data, _, done, error in
                if let data, let got = buffer.append(data) { got.forEach(lines) }
                if done || error != nil { close(); return }
                read()
            }
        }
        conn.stateUpdateHandler = { if case .cancelled = $0 { close() } }
        conn.start(queue: queue)
        conn.sendLine(hello)
        read()
        return conn
    }

    func testAStandInForTheMacWithoutTheKeyIsNotLinked() {
        startLink(macPort: startEchoServer())
        let refused = expectation(description: "the impostor is closed")
        var openedForIntruder = false
        var intruder: NWConnection!
        intruder = rawLink(LinkProtocol.line(.control(nonce: "abcd")), lines: { line in
            if line.hasPrefix("OPEN") { openedForIntruder = true }
            // It cannot make the Mac's proof, so it guesses one.
            if line.hasPrefix("AUTH ") { intruder.sendLine(LinkProtocol.line(.authOK(proof: "00ff"))) }
        }, closed: { refused.fulfill() })
        wait(for: [refused], timeout: 3)
        // The Mac still has the link: a page connection crosses it.
        XCTAssertEqual(roundTrip(Data("still mine".utf8)), Data("still mine".utf8))
        XCTAssertFalse(openedForIntruder, "the intruder was told of no stream")
        intruder.cancel()
    }

    func testAnotherVersionIsToldSoBeforeTheIPadCloses() {
        server = LinkServer(devicePort: devicePort, pagePort: pagePort, key: key)
        server.start()
        Thread.sleep(forTimeInterval: 0.3)
        let told = expectation(description: "unsupported")
        var answer = ""
        let conn = rawLink("VAMPLINK 1 CONTROL\n", lines: { line in
            answer = line
            told.fulfill()
        })
        wait(for: [told], timeout: 3)
        XCTAssertEqual(answer, String(LinkProtocol.unsupportedLine().dropLast()))
        conn.cancel()
    }

    func testAStreamWithoutTheSessionsTagIsClosed() {
        startLink(macPort: startEchoServer())
        let closed = expectation(description: "closed")
        let conn = rawLink(LinkProtocol.line(.stream(id: 12345, tag: "abcdef")), lines: { _ in }, closed: { closed.fulfill() })
        wait(for: [closed], timeout: 3)
        conn.cancel()
    }

    func testASilentLinkIsDropped() {
        server = LinkServer(devicePort: devicePort, pagePort: pagePort, key: key)
        server.silenceLimit = 1
        let up = expectation(description: "linked")
        let down = expectation(description: "dropped")
        server.onLinkChange = { linked in linked ? up.fulfill() : down.fulfill() }
        server.start()
        Thread.sleep(forTimeInterval: 0.3)
        // The Mac's side of the handshake, by hand, then silence, as a
        // half-open connection.
        var conn: NWConnection!
        conn = rawLink(LinkProtocol.line(.control(nonce: "abcd")), lines: { line in
            guard case .auth(_, let padNonce, _) = LinkProtocol.parseAuth(line) else { return }
            conn.sendLine(LinkProtocol.line(.authOK(proof: LinkAuth.proof(self.key.symmetric, "mac", "abcd", padNonce))))
        })
        wait(for: [up], timeout: 3)
        wait(for: [down], timeout: 4)
        conn.cancel()
    }

    // MARK: - Pairing

    func testAnIPadTheMacDoesNotKnowPairsWithTheCodeAndIsRememberedBySerial() {
        let macPort = startEchoServer()
        server = LinkServer(devicePort: devicePort, pagePort: pagePort, key: key)
        let asked = expectation(description: "the iPad asks for the code")
        let linked = expectation(description: "linked")
        let pairedEvent = expectation(description: "paired")
        server.onPairing = { if $0 == .codeNeeded { asked.fulfill() } else if $0 == .paired { pairedEvent.fulfill() } }
        server.onLinkChange = { if $0 { linked.fulfill() } }
        server.start()
        var shown: String?
        client = makeClient(macPort: macPort, serial: "IPAD-1")
        client!.onPairingCode = { code in if let code { shown = code } }
        client!.start()
        wait(for: [asked], timeout: 5)
        // The person types the code the Mac's menu shows.
        server.submitCode(try! XCTUnwrap(shown))
        wait(for: [linked, pairedEvent], timeout: 5)
        XCTAssertEqual(paired.key(for: key.id), key, "the Mac keeps the iPad's key")
        XCTAssertTrue(paired.knows(serial: "IPAD-1"))
        XCTAssertEqual(PairedIPads(file: pairedFile).key(for: key.id), key, "on disk too")
        XCTAssertEqual(roundTrip(Data("paired".utf8)), Data("paired".utf8))
    }

    func testAWrongCodeIsToldSoAndTooManyEndThePairing() {
        let macPort = startEchoServer()
        server = LinkServer(devicePort: devicePort, pagePort: pagePort, key: key)
        var events: [LinkServer.PairingEvent] = []
        let ended = expectation(description: "ended")
        let asked = expectation(description: "asked")
        asked.assertForOverFulfill = false
        server.onPairing = { event in
            events.append(event)
            if event == .codeNeeded { asked.fulfill() }
            if event == .ended { ended.fulfill() }
        }
        server.start()
        var shown = ""
        client = makeClient(macPort: macPort)
        client!.onPairingCode = { code in if let code { shown = code } }
        client!.start()
        wait(for: [asked], timeout: 5)
        let wrong = shown == "000000" ? "111111" : "000000"
        for _ in 0..<LinkProtocol.pairingTries {
            server.submitCode(wrong)
            Thread.sleep(forTimeInterval: 0.1)
        }
        wait(for: [ended], timeout: 5)
        XCTAssertTrue(events.contains(.wrongCode(triesLeft: LinkProtocol.pairingTries - 1)))
        XCTAssertNil(paired.key(for: key.id), "nothing was paired")
    }

    func testAStandInForTheIPadWithoutItsKeyIsDenied() {
        // The Mac knows this iPad's key; another app answering on its port
        // names it but cannot prove it.
        paired.add(key, serial: nil)
        let listener = try! NWListener(using: .loopbackListener(port: devicePort))
        let denied = expectation(description: "denied")
        listener.newConnectionHandler = { conn in
            conn.start(queue: self.queue)
            var buffer = LineBuffer()
            func read() {
                conn.receive(minimumIncompleteLength: 1, maximumLength: 4096) { data, _, done, _ in
                    for line in data.flatMap({ buffer.append($0) }) ?? [] {
                        if case .control = LinkProtocol.parseHello(line) {
                            conn.sendLine(LinkProtocol.line(.auth(keyId: self.key.id, nonce: "aa", proof: "bb")))
                        }
                        if LinkProtocol.parseAuth(line) == .denied { denied.fulfill() }
                    }
                    if !done { read() }
                }
            }
            read()
        }
        listener.start(queue: queue)
        var linked = false
        client = makeClient(macPort: freePort())
        client!.onLinkChange = { if $0 { linked = true } }
        client!.start()
        wait(for: [denied], timeout: 5)
        client!.stop()
        listener.cancel()
        XCTAssertFalse(linked)
    }

    // MARK: - A Vamp for iPad from before the handshake

    /// The iPad's end as version 1 spoke it: it closes on any hello but its
    /// own, and links on `VAMPLINK 1 CONTROL` with no proof.
    private func startLegacyIPad() -> (NWListener, XCTestExpectation) {
        let listener = try! NWListener(using: .loopbackListener(port: devicePort))
        let legacyHello = expectation(description: "spoken to in version 1")
        legacyHello.assertForOverFulfill = false
        listener.newConnectionHandler = { conn in
            conn.start(queue: self.queue)
            var buffer = LineBuffer()
            conn.receive(minimumIncompleteLength: 1, maximumLength: 4096) { data, _, _, _ in
                let lines = data.flatMap { buffer.append($0) } ?? []
                if lines.first == String(LinkProtocol.legacyControlLine().dropLast()) {
                    legacyHello.fulfill()
                } else {
                    conn.cancel()
                }
            }
        }
        listener.start(queue: queue)
        return (listener, legacyHello)
    }

    func testAnOlderIPadAppGetsTheUnauthenticatedLinkAndTheMacSaysSo() {
        let (listener, legacyHello) = startLegacyIPad()
        let legacy = expectation(description: "unauthenticated")
        client = makeClient(macPort: freePort(), serial: "OLD-IPAD")
        client!.onLegacy = { if $0 { legacy.fulfill() } }
        client!.start()
        wait(for: [legacyHello, legacy], timeout: 5)
        listener.cancel()
    }

    func testAnIPadThatHasPairedIsNeverDowngraded() {
        paired.add(key, serial: "IPAD-1")
        let (listener, legacyHello) = startLegacyIPad()
        legacyHello.isInverted = true
        let refused = expectation(description: "refused")
        refused.assertForOverFulfill = false
        client = makeClient(macPort: freePort(), serial: "IPAD-1",
                            legacyAllowed: { [paired] in !paired!.knows(serial: "IPAD-1") })
        client!.onIncompatible = { _ in refused.fulfill() }
        client!.start()
        wait(for: [refused], timeout: 5)
        wait(for: [legacyHello], timeout: 0.5)
        listener.cancel()
    }
}

final class CableOnlyInterfacesTests: XCTestCase {
    /// The iPad's USB network has only a self-assigned address; the Mac's
    /// own Wi-Fi and LAN have routable ones and are never excluded.
    func testOnlyASelfAssignedOnlyInterfaceIsExcluded() {
        let names = CableOnlyInterfaces.selfAssignedOnly([
            ("en15", "169.254.252.27"),
            ("en0", "10.43.159.47"),
            ("en7", "169.254.3.4"), ("en7", "192.168.50.12"),
            ("lo0", "127.0.0.1"),
        ])
        XCTAssertEqual(names, ["en15"])
    }

    func testThisMacsInterfacesAreRead() {
        let found = CableOnlyInterfaces.ipv4Addresses()
        XCTAssertTrue(found.contains { $0.name == "lo0" && $0.ipv4 == "127.0.0.1" })
    }
}
