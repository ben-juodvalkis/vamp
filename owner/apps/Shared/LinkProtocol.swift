import Foundation

/// The wire between Vamp for Mac and Vamp for iPad (ADR-488; authenticated
/// since version 2, ADR-494; over Wi-Fi as well as the cable, ADR-504).
///
/// Over Wi-Fi the same wire runs inside TLS whose pre-shared key comes from
/// the pair's key, so only a paired Mac can reach the iPad there at all;
/// the handshake below then runs as it does on the cable, minus pairing,
/// which is the cable's alone.
///
/// usbmux (Apple's device channel over the USB cable) only lets the Mac
/// open connections to a port on the iPad, never the other way. So the iPad
/// app listens on `devicePort` and the Mac dials it, twice over:
///
/// - one **control** connection, held open while the cable is in. It opens
///   with a handshake that proves both ends hold the key they share
///   (`LinkAuth`), or pairs them once with a code. Then the iPad asks for
///   streams on it (`OPEN <id>`) and the Mac pings it (`PING`/`PONG`) so a
///   half-open link is noticed in seconds, not at TCP's leisure.
/// - one **stream** connection per connection the iPad's web view opens
///   (the page, its assets, the bridge WebSocket). It starts with
///   `VAMPLINK 2 STREAM <id> <tag>` — the tag only the paired Mac in this
///   session can make — and is raw bytes after that line, spliced on the
///   Mac to its own page server.
///
/// The control handshake, Mac first:
///
///     VAMPLINK 2 CONTROL <mac nonce>
///                                  AUTH <key id> <pad nonce> <pad proof>
///     AUTHOK <mac proof>                       (the Mac knows the key)
///
///     PAIR                                     (it does not: a code is shown on the Mac)
///                                  PAIRCODE <proof by the code>
///     PAIRWRONG <tries left> | PAIROK <proof by the code>
///                                  KEY <the key>
///     AUTHOK <mac proof>
///
///     DENIED                                   (a proof failed, or too many tries)
///
/// Every message is one ASCII line ending in `\n`. The first line on any
/// connection says what it is. An iPad that does not speak the Mac's
/// version answers `VAMPLINK-UNSUPPORTED <versions it speaks>` before it
/// closes, so the Mac can say "update Vamp for iPad" instead of "not open".
/// Version 1 (no handshake, sequential stream ids) is spoken only by the Mac,
/// to a Vamp for iPad installed before version 2, while it is allowed.
enum LinkProtocol {
    static let version = 2
    static let legacyVersion = 1

    /// The timings both ends must agree on, in one place.
    /// The Mac pings every `pingInterval` and drops a control connection
    /// that has not answered in `pongLimit`.
    static let pingInterval: TimeInterval = 2
    static let pongLimit: TimeInterval = 6
    /// The iPad drops a control connection it has heard nothing on in
    /// `silenceLimit` (the cable can leave a connection half-open), and
    /// lets a second one replace it only once it has been quiet for
    /// `healthyWithin`: a newcomer cannot take a working link over.
    static let silenceLimit: TimeInterval = 6
    static let healthyWithin: TimeInterval = 3
    /// How long a page connection waits for the Mac's stream.
    static let streamWait: TimeInterval = 5
    /// How long a handshake may take before it is dropped; a pairing waits
    /// for a person, so it has longer.
    static let handshakeLimit: TimeInterval = 10
    static let pairingLimit: TimeInterval = 180
    /// Wrong codes before the Mac ends the pairing (a new code on the next).
    static let pairingTries = 5

    /// Over Wi-Fi (ADR-504) the iPad also listens on its network, inside
    /// TLS keyed by the pair's key (`NWParameters.wifiLink`), and advertises
    /// itself with Bonjour under this type. Its TXT record carries the key's
    /// id under `txtKeyId`, so a Mac dials only an iPad it has paired with.
    static let bonjourType = "_vamplink._tcp"
    static let txtKeyId = "k"
    /// A QR pairing (ADR-505): the iPad advertises a second service, inside
    /// TLS keyed by the QR code's one-time secret, with the secret's id
    /// under `txtPairingId`. Only the Mac that showed the code knows the id
    /// and can make the key. The pairing then runs as on the cable, with
    /// the secret as its code, typed by nobody.
    static let txtPairingId = "p"
    /// The link a QR code carries: `vamp://pair?s=<secret>`.
    static let urlScheme = "vamp"
    static let pairHost = "pair"

    static func pairingURL(secret: String) -> String { "\(urlScheme)://\(pairHost)?s=\(secret)" }

    /// The secret in a scanned pairing link, if it is one.
    static func pairingSecret(from url: URL) -> String? {
        guard url.scheme == urlScheme, url.host == pairHost,
              let s = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "s" })?.value,
              LinkAuth.isPairingSecret(s) else { return nil }
        return s.lowercased()
    }

    /// The first line of an iPad's refusal of a version it does not speak.
    static let unsupported = "VAMPLINK-UNSUPPORTED"

    static func unsupportedLine() -> String { "\(unsupported) \(version)\n" }

    enum Hello: Equatable {
        case control(nonce: String)
        case stream(id: UInt32, tag: String)
    }

    enum Control: Equatable {
        case open(UInt32)
        case ping
        case pong
    }

    enum Auth: Equatable {
        case auth(keyId: String, nonce: String, proof: String)
        case authOK(proof: String)
        case pair
        case pairCode(proof: String)
        case pairOK(proof: String)
        case pairWrong(triesLeft: Int)
        case key(hex: String)
        case denied
    }

    static func line(_ hello: Hello) -> String {
        switch hello {
        case .control(let nonce): return "VAMPLINK \(version) CONTROL \(nonce)\n"
        case .stream(let id, let tag): return "VAMPLINK \(version) STREAM \(id) \(tag)\n"
        }
    }

    /// Version 1's hellos, for a Vamp for iPad installed before version 2.
    static func legacyControlLine() -> String { "VAMPLINK \(legacyVersion) CONTROL\n" }
    static func legacyStreamLine(_ id: UInt32) -> String { "VAMPLINK \(legacyVersion) STREAM \(id)\n" }

    /// Whether `line` is a hello of a version this end does not speak: a
    /// `VAMPLINK` line, but not this version's.
    static func isOtherVersion(_ line: String) -> Bool {
        let parts = line.split(separator: " ")
        return parts.count >= 2 && parts[0] == "VAMPLINK" && parts[1] != "\(version)"
    }

    static func parseHello(_ line: String) -> Hello? {
        let parts = line.split(separator: " ").map(String.init)
        guard parts.count >= 3, parts[0] == "VAMPLINK", parts[1] == "\(version)" else { return nil }
        switch parts[2] {
        case "CONTROL" where parts.count == 4 && isToken(parts[3]):
            return .control(nonce: parts[3])
        case "STREAM" where parts.count == 5 && isToken(parts[4]):
            return UInt32(parts[3]).map { .stream(id: $0, tag: parts[4]) }
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

    static func line(_ message: Auth) -> String {
        switch message {
        case .auth(let keyId, let nonce, let proof): return "AUTH \(keyId) \(nonce) \(proof)\n"
        case .authOK(let proof): return "AUTHOK \(proof)\n"
        case .pair: return "PAIR\n"
        case .pairCode(let proof): return "PAIRCODE \(proof)\n"
        case .pairOK(let proof): return "PAIROK \(proof)\n"
        case .pairWrong(let left): return "PAIRWRONG \(left)\n"
        case .key(let hex): return "KEY \(hex)\n"
        case .denied: return "DENIED\n"
        }
    }

    static func parseAuth(_ line: String) -> Auth? {
        let parts = line.split(separator: " ").map(String.init)
        guard let head = parts.first, parts.dropFirst().allSatisfy(isToken) else { return nil }
        switch (head, parts.count) {
        case ("AUTH", 4): return .auth(keyId: parts[1], nonce: parts[2], proof: parts[3])
        case ("AUTHOK", 2): return .authOK(proof: parts[1])
        case ("PAIR", 1): return .pair
        case ("PAIRCODE", 2): return .pairCode(proof: parts[1])
        case ("PAIROK", 2): return .pairOK(proof: parts[1])
        case ("PAIRWRONG", 2): return Int(parts[1]).map { .pairWrong(triesLeft: $0) }
        case ("KEY", 2): return .key(hex: parts[1])
        case ("DENIED", 1): return .denied
        default: return nil
        }
    }

    /// Hex and digits only, of a sane length: nonces, ids, proofs, keys.
    private static func isToken(_ s: String) -> Bool {
        !s.isEmpty && s.count <= 128 && s.allSatisfy { $0.isHexDigit }
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
