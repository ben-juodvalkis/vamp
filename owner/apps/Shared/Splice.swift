import Foundation
import Network

/// Two connections joined end to end: whatever arrives on one is written to
/// the other, both ways, until either side ends. Then both are cancelled,
/// once.
///
/// Each direction waits for its write to be taken before it reads again, so
/// a slow side holds the fast one back instead of piling bytes up in memory.
final class Splice {
    private let a: NWConnection
    private let b: NWConnection
    private let queue: DispatchQueue
    private var ended = false
    var onEnd: (() -> Void)?

    init(_ a: NWConnection, _ b: NWConnection, queue: DispatchQueue) {
        self.a = a
        self.b = b
        self.queue = queue
    }

    /// Start pumping. `leadingToB` is bytes already read from `a` (what
    /// followed a hello line) that must reach `b` before anything else.
    func start(leadingToB: Data = Data()) {
        if leadingToB.isEmpty {
            pump(from: a, to: b)
        } else {
            b.send(content: leadingToB, completion: .contentProcessed { [weak self] error in
                guard let self else { return }
                if error != nil { self.end(); return }
                self.pump(from: self.a, to: self.b)
            })
        }
        pump(from: b, to: a)
    }

    func end() {
        queue.async { [weak self] in
            guard let self, !self.ended else { return }
            self.ended = true
            self.a.cancel()
            self.b.cancel()
            self.onEnd?()
            self.onEnd = nil
        }
    }

    private func pump(from: NWConnection, to: NWConnection) {
        from.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self, !self.ended else { return }
            if let data, !data.isEmpty {
                to.send(content: data, completion: .contentProcessed { [weak self] sendError in
                    guard let self else { return }
                    if sendError != nil || isComplete { self.end(); return }
                    self.pump(from: from, to: to)
                })
            } else if isComplete || error != nil {
                self.end()
            } else {
                self.pump(from: from, to: to)
            }
        }
    }
}

extension NWConnection {
    /// Send one protocol line; errors end up in the caller's state handler.
    func sendLine(_ line: String) {
        send(content: Data(line.utf8), completion: .contentProcessed { _ in })
    }
}

extension NWParameters {
    /// Plain TCP, no delay: the link carries UI gestures, where Nagle's
    /// batching would show up as lag.
    static func linkTCP() -> NWParameters {
        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        let params = NWParameters(tls: nil, tcp: tcp)
        params.allowLocalEndpointReuse = true
        return params
    }

    /// The same, bound to loopback: nothing on the network can reach it.
    static func loopbackListener(port: UInt16) -> NWParameters {
        let params = linkTCP()
        params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: port)!)
        return params
    }
}
