import Foundation

/// The wire between Vamp for Mac and Vamp for iPad.
///
/// usbmux (Apple's device channel over the USB cable) only lets the Mac
/// open connections to a port on the iPad, never the other way. So the iPad
/// app listens on `devicePort` and the Mac dials it, twice over:
///
/// - one **control** connection, held open while the cable is in. The iPad
///   asks for streams on it (`OPEN <id>`); the Mac pings it (`PING`/`PONG`)
///   so a half-open link is noticed in seconds, not at TCP's leisure.
/// - one **stream** connection per connection the iPad's web view opens
///   (the page, its assets, the bridge WebSocket). It starts with
///   `VAMPLINK 1 STREAM <id>` and is raw bytes after that line, spliced on
///   the Mac to its own page server.
///
/// Every message is one ASCII line ending in `\n`. The first line on any
/// connection says what it is.
enum LinkProtocol {
    static let version = 1

    enum Hello: Equatable {
        case control
        case stream(UInt32)
    }

    enum Control: Equatable {
        case open(UInt32)
        case ping
        case pong
    }

    static func line(_ hello: Hello) -> String {
        switch hello {
        case .control: return "VAMPLINK \(version) CONTROL\n"
        case .stream(let id): return "VAMPLINK \(version) STREAM \(id)\n"
        }
    }

    static func parseHello(_ line: String) -> Hello? {
        let parts = line.split(separator: " ")
        guard parts.count >= 3, parts[0] == "VAMPLINK", parts[1] == "\(version)" else { return nil }
        switch parts[2] {
        case "CONTROL" where parts.count == 3:
            return .control
        case "STREAM" where parts.count == 4:
            return UInt32(parts[3]).map(Hello.stream)
        default:
            return nil
        }
    }

    static func line(_ message: Control) -> String {
        switch message {
        case .open(let id): return "OPEN \(id)\n"
        case .ping: return "PING\n"
        case .pong: return "PONG\n"
        }
    }

    static func parseControl(_ line: String) -> Control? {
        let parts = line.split(separator: " ")
        switch (parts.first, parts.count) {
        case ("OPEN", 2): return UInt32(parts[1]).map(Control.open)
        case ("PING", 1): return .ping
        case ("PONG", 1): return .pong
        default: return nil
        }
    }
}

/// Splits a byte stream into `\n`-terminated lines. What follows the last
/// newline stays in `remainder`: on a stream connection that is the first
/// of the raw bytes, which must not be lost.
struct LineBuffer {
    private(set) var remainder = Data()
    /// A line longer than this is not the protocol; the caller drops the
    /// connection rather than buffering without bound.
    static let maxLine = 256

    /// The complete lines in `data` (and whatever was pending), without
    /// their newlines. `nil` when a line has grown past `maxLine`.
    mutating func append(_ data: Data) -> [String]? {
        remainder.append(data)
        var lines: [String] = []
        while let newline = remainder.firstIndex(of: 0x0A) {
            let lineData = remainder[remainder.startIndex..<newline]
            remainder = Data(remainder[remainder.index(after: newline)...])
            lines.append(String(decoding: lineData, as: UTF8.self))
        }
        if remainder.count > Self.maxLine { return nil }
        return lines
    }

    /// Hand back the pending bytes and forget them.
    mutating func takeRemainder() -> Data {
        defer { remainder = Data() }
        return remainder
    }
}
