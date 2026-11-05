import CryptoKit
import Foundation

/// The key a paired Vamp for iPad and Vamp for Mac share (ADR-494): 32
/// random bytes the iPad makes once and keeps in its Keychain, and gives the
/// Mac when the two pair. `id` names it on the wire without revealing it.
struct LinkKey: Equatable {
    let raw: Data

    init(raw: Data) { self.raw = raw }

    static func random() -> LinkKey {
        LinkKey(raw: Data((0..<32).map { _ in UInt8.random(in: 0...255) }))
    }

    var symmetric: SymmetricKey { SymmetricKey(data: raw) }
    var hex: String { raw.hexString }
    /// The first 8 bytes of its SHA-256, in hex.
    var id: String { Data(SHA256.hash(data: raw)).prefix(8).hexString }

    init?(hex: String) {
        guard let data = Data(hex: hex), data.count == 32 else { return nil }
        raw = data
    }
}

/// The proofs both ends of the link exchange. Every proof is an HMAC-SHA256
/// over the role and both ends' fresh nonces, so none can be replayed into
/// another session or passed off as the other end's.
enum LinkAuth {
    /// 16 random bytes in hex: a fresh one per control connection, per end.
    static func nonce() -> String {
        Data((0..<16).map { _ in UInt8.random(in: 0...255) }).hexString
    }

    /// A six-digit pairing code, shown on the Mac and typed on the iPad.
    static func newCode() -> String {
        String(format: "%06d", Int.random(in: 0...999_999))
    }

    static func proof(_ key: SymmetricKey, _ parts: String...) -> String {
        let message = Data(parts.joined(separator: "|").utf8)
        return Data(HMAC<SHA256>.authenticationCode(for: message, using: key)).hexString
    }

    /// The key a pairing code stands for while the two pair.
    static func codeKey(_ code: String) -> SymmetricKey {
        SymmetricKey(data: SHA256.hash(data: Data("vamp-link-pair|\(code)".utf8)))
    }

    /// The pre-shared key of the Wi-Fi link's TLS (ADR-504): derived from
    /// the pair's key, never the key itself, so the two uses stay apart.
    static func wifiPSK(_ key: LinkKey) -> Data {
        Data(HMAC<SHA256>.authenticationCode(for: Data("vamp-link-wifi-tls".utf8), using: key.symmetric))
    }

    /// The tag a stream connection carries: only an end that holds the key
    /// and was part of this control session can make it.
    static func streamTag(_ key: SymmetricKey, macNonce: String, padNonce: String, id: UInt32) -> String {
        String(proof(key, "stream", macNonce, padNonce, String(id)).prefix(32))
    }

    /// Equal, in time that does not depend on where they differ.
    static func same(_ a: String, _ b: String) -> Bool {
        let x = Array(a.utf8), y = Array(b.utf8)
        guard x.count == y.count else { return false }
        var diff: UInt8 = 0
        for i in 0..<x.count { diff |= x[i] ^ y[i] }
        return diff == 0
    }
}

extension Data {
    var hexString: String { map { String(format: "%02x", $0) }.joined() }

    init?(hex: String) {
        guard hex.count % 2 == 0 else { return nil }
        var bytes = [UInt8]()
        bytes.reserveCapacity(hex.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
            bytes.append(byte)
            index = next
        }
        self.init(bytes)
    }
}
