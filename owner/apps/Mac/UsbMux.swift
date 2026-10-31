import Foundation
import Network

/// Opens a connection to the iPad app's link port and calls back with it
/// ready (started on `queue`), plus any bytes already read past the dial's
/// own handshake — or nil when it could not.
typealias LinkDialer = (_ queue: DispatchQueue, _ done: @escaping (NWConnection?, Data) -> Void) -> Void

/// usbmuxd: macOS's daemon for devices on the USB cable, the same channel
/// Finder and Xcode use. Its socket speaks 16-byte headers and XML plists:
/// `Listen` streams attach/detach events, and `Connect` turns the socket
/// into a raw pipe to a TCP port on the device.
enum UsbMux {
    static let socketPath = "/var/run/usbmuxd"

    static func packet(_ message: [String: Any], tag: UInt32) -> Data {
        var body = message
        body["ClientVersionString"] = "vamp"
        body["ProgName"] = "Vamp"
        let plist = (try? PropertyListSerialization.data(fromPropertyList: body, format: .xml, options: 0)) ?? Data()
        var header = Data(count: 16)
        header.withUnsafeMutableBytes { raw in
            raw.storeBytes(of: UInt32(16 + plist.count).littleEndian, toByteOffset: 0, as: UInt32.self)
            raw.storeBytes(of: UInt32(1).littleEndian, toByteOffset: 4, as: UInt32.self) // version
            raw.storeBytes(of: UInt32(8).littleEndian, toByteOffset: 8, as: UInt32.self) // plist message
            raw.storeBytes(of: tag.littleEndian, toByteOffset: 12, as: UInt32.self)
        }
        return header + plist
    }

    /// The first whole packet in `data`: its plist and its length in
    /// bytes. Nil while the packet is incomplete.
    static func parsePacket(_ data: Data) -> (message: [String: Any], length: Int)? {
        guard data.count >= 16 else { return nil }
        let start = data.startIndex
        let length = Int(data[start..<start + 4].withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }.littleEndian)
        guard length >= 16, data.count >= length else { return nil }
        let body = data[(start + 16)..<(start + length)]
        let message = (try? PropertyListSerialization.propertyList(from: Data(body), format: nil)) as? [String: Any]
        return (message ?? [:], length)
    }

    /// usbmuxd wants the port in network byte order, read as a host integer.
    static func wirePort(_ port: UInt16) -> Int { Int(port.bigEndian) }

    /// A dialer for `port` on the device usbmuxd calls `deviceID`.
    static func dialer(deviceID: Int, port: UInt16) -> LinkDialer {
        return { queue, done in
            let conn = NWConnection(to: .unix(path: socketPath), using: .tcp)
            var finished = false
            let finish: (NWConnection?, Data) -> Void = { result, rest in
                guard !finished else { return }
                finished = true
                if result == nil { conn.cancel() }
                done(result, rest)
            }
            conn.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    conn.send(content: packet(["MessageType": "Connect", "DeviceID": deviceID, "PortNumber": wirePort(port)], tag: 1),
                              completion: .contentProcessed { _ in })
                    readResult(conn, pending: Data(), finish: finish)
                case .failed, .cancelled:
                    finish(nil, Data())
                default:
                    break
                }
            }
            conn.start(queue: queue)
            queue.asyncAfter(deadline: .now() + 3) { finish(nil, Data()) }
        }
    }

    /// Plain TCP to `port` on this Mac's loopback: where the iPad app
    /// listens when it runs in the Simulator, and the tests' stand-in for
    /// usbmux.
    static func loopbackDialer(port: UInt16) -> LinkDialer {
        return { queue, done in
            let conn = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!, using: .linkTCP())
            var finished = false
            conn.stateUpdateHandler = { state in
                guard !finished else { return }
                switch state {
                case .ready:
                    finished = true
                    done(conn, Data())
                case .failed, .waiting:
                    finished = true
                    conn.cancel()
                    done(nil, Data())
                default:
                    break
                }
            }
            conn.start(queue: queue)
        }
    }

    private static func readResult(_ conn: NWConnection, pending: Data, finish: @escaping (NWConnection?, Data) -> Void) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 4096) { data, _, isComplete, error in
            var pending = pending
            if let data { pending.append(data) }
            if let (message, length) = parsePacket(pending) {
                let ok = (message["Number"] as? Int) == 0
                // Past the reply the socket is the device's port, raw.
                finish(ok ? conn : nil, Data(pending.dropFirst(length)))
            } else if isComplete || error != nil {
                finish(nil, Data())
            } else {
                readResult(conn, pending: pending, finish: finish)
            }
        }
    }
}

/// Follows devices on the cable: one `Listen` to usbmuxd, redialled if
/// usbmuxd restarts. Network-attached devices (Wi-Fi sync) are ignored.
///
/// While nothing is on the cable the `Listen` is renewed every
/// `idleRenewal`: usbmuxd announces every attached device to a new one, so
/// an attach the old one never heard turns up within that time. Measured on
/// the rig, 2026-10-31: a Vamp for Mac running for 90 minutes said "not
/// plugged in" with the iPad on the cable while usbmuxd announced it to any
/// new listener, and a relaunch linked at once. A `Listen` that stalls
/// (`waiting`) is dropped and redialled too. A device on the cable keeps
/// its `Listen`, so a live link is never touched.
final class UsbMuxWatcher {
    /// A device on the cable: its usbmux id and its serial number (UDID).
    var onAttach: ((Int, String?) -> Void)?
    var onDetach: ((Int) -> Void)?
    /// State changes worth a line in the log, never per message.
    var log: ((String) -> Void)?

    static let idleRenewal: TimeInterval = 20

    private let queue: DispatchQueue
    private var conn: NWConnection?
    private var pending = Data()
    private var usbDevices = Set<Int>()
    private var running = false
    /// When the current `Listen` replaced an idle one, for the log: an attach
    /// heard right after says the old one had missed it.
    private var renewedAt: Date?

    init(queue: DispatchQueue) {
        self.queue = queue
    }

    func start() {
        queue.async { [self] in
            running = true
            connect()
        }
    }

    private func connect() {
        let conn = NWConnection(to: .unix(path: UsbMux.socketPath), using: .tcp)
        self.conn = conn
        pending = Data()
        conn.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                conn.send(content: UsbMux.packet(["MessageType": "Listen"], tag: 1), completion: .contentProcessed { _ in })
                self.read(conn)
                self.renewWhileIdle(conn)
            case .waiting(let error):
                self.log?("usbmuxd did not answer (\(error)); dialling it again")
                conn.cancel()
            case .failed, .cancelled:
                self.lost(conn)
            default:
                break
            }
        }
        conn.start(queue: queue)
    }

    /// Renew `conn` after `idleRenewal` if nothing is on the cable by then.
    private func renewWhileIdle(_ conn: NWConnection) {
        queue.asyncAfter(deadline: .now() + Self.idleRenewal) { [weak self] in
            guard let self, self.running, self.conn === conn else { return }
            guard self.usbDevices.isEmpty else { return self.renewWhileIdle(conn) }
            self.conn = nil
            conn.cancel()
            self.renewedAt = Date()
            self.connect()
        }
    }

    private func read(_ conn: NWConnection) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self, self.conn === conn else { return }
            if let data { self.pending.append(data) }
            while let (message, length) = UsbMux.parsePacket(self.pending) {
                self.pending = Data(self.pending.dropFirst(length))
                self.handle(message)
            }
            if isComplete || error != nil {
                conn.cancel()
            } else {
                self.read(conn)
            }
        }
    }

    private func handle(_ message: [String: Any]) {
        guard let id = message["DeviceID"] as? Int else { return }
        switch message["MessageType"] as? String {
        case "Attached":
            let props = message["Properties"] as? [String: Any]
            guard (props?["ConnectionType"] as? String) == "USB", !usbDevices.contains(id) else { return }
            usbDevices.insert(id)
            if let at = renewedAt, Date().timeIntervalSince(at) < 2 {
                log?("the renewed watch found an iPad the last one had missed")
            }
            renewedAt = nil
            onAttach?(id, props?["SerialNumber"] as? String)
        case "Detached":
            guard usbDevices.remove(id) != nil else { return }
            onDetach?(id)
        default:
            break
        }
    }

    private func lost(_ conn: NWConnection) {
        guard self.conn === conn else { return }
        self.conn = nil
        // usbmuxd will re-announce whatever is attached; until then nothing is.
        for id in usbDevices { onDetach?(id) }
        usbDevices.removeAll()
        guard running else { return }
        queue.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self, self.running, self.conn == nil else { return }
            self.connect()
        }
    }
}
