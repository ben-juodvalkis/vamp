import Foundation

/// A single OSC argument on the wire. The Looping wire only uses ints and
/// strings for the addresses this app touches, but doubles are handled so an
/// unexpected float (e.g. tempo) never crashes the decoder.
enum OSCArg {
    case int(Int)
    case double(Double)
    case string(String)

    /// 0/1 flag reader for the `[0|1]` toggle args.
    var intValue: Int? {
        switch self {
        case .int(let v): return v
        case .double(let v): return Int(v)
        case .string(let s): return Int(s)
        }
    }

    /// String reader for text args (e.g. the server_mode beacon).
    var stringValue: String? {
        switch self {
        case .string(let s): return s
        case .int(let v): return String(v)
        case .double(let v): return String(v)
        }
    }
}

struct OSCMessage {
    let address: String
    let args: [OSCArg]
}

/// The JSON envelope the bridge speaks over the WebSocket. This is a faithful
/// port of the two functions the web UI uses, so the menu bar is
/// byte-for-byte compatible with the existing clients:
///   - send:    `buildWireMessage` in WebSocketConnection.ts → { address, args, argsTypes }
///   - receive: `dispatchInbound`   in WebSocketConnection.ts → { address, args } (+ /bridge/batch unwrap)
enum OSCEnvelope {
    /// Encode an outbound frame. `argsTypes` uses JS `typeof` names
    /// ("number"/"string") exactly as `buildWireMessage` does.
    static func encode(_ address: String, _ args: [OSCArg]) -> Data? {
        var jsonArgs: [Any] = []
        var argsTypes: [String] = []
        for arg in args {
            switch arg {
            case .int(let v):
                jsonArgs.append(v)
                argsTypes.append("number")
            case .double(let v):
                jsonArgs.append(v)
                argsTypes.append("number")
            case .string(let v):
                jsonArgs.append(v)
                argsTypes.append("string")
            }
        }
        let obj: [String: Any] = ["address": address, "args": jsonArgs, "argsTypes": argsTypes]
        return try? JSONSerialization.data(withJSONObject: obj)
    }

    /// Decode one inbound text frame into zero or more messages. A
    /// `/bridge/batch` envelope (the bridge's broadcast coalescer) is
    /// unwrapped into its inner messages, in order — downstream never learns
    /// the frame arrived batched (same contract as `dispatchInbound`).
    static func decode(_ text: String) -> [OSCMessage] {
        guard
            let data = text.data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return []
        }
        return decodeObject(obj)
    }

    private static func decodeObject(_ obj: [String: Any]) -> [OSCMessage] {
        let address = obj["address"] as? String ?? ""

        if address == Wire.bridgeBatch, let inner = obj["messages"] as? [[String: Any]] {
            return inner.flatMap { decodeObject($0) }
        }

        guard !address.isEmpty else { return [] }
        let rawArgs = obj["args"] as? [Any] ?? []
        return [OSCMessage(address: address, args: rawArgs.map(toArg))]
    }

    private static func toArg(_ value: Any) -> OSCArg {
        // JSONSerialization yields NSNumber for all JSON numbers (and bools).
        // Order matters: integral numbers first, then fractional, then string.
        if let s = value as? String { return .string(s) }
        if let num = value as? NSNumber {
            // Distinguish integral from fractional without misreading bools.
            if num.doubleValue == num.doubleValue.rounded() {
                return .int(num.intValue)
            }
            return .double(num.doubleValue)
        }
        return .string("\(value)")
    }
}
