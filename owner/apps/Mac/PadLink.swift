import Foundation
import Network

/// Vamp for iPad, from the Mac's side: follows the iPad on the USB cable
/// and keeps a `LinkClient` to its app while it is plugged in.
///
/// `VAMP_LINK_DIRECT=1` dials the app's port on this Mac's own loopback
/// instead of through usbmux: that is where the app listens when it runs in
/// the iOS Simulator.
@MainActor
final class PadLink: ObservableObject {
    enum Status: Equatable {
        case noPad
        /// On the cable; the app is not open yet (or not answering).
        case padWithoutApp
        /// The app answered with a link version this Mac does not speak.
        case needsUpdate
        case linked
    }

    @Published private(set) var status: Status = .noPad
    /// The code to type on the iPad while one pairs with this Mac (ADR-494).
    @Published private(set) var pairingCode: String?
    /// A linked iPad runs a Vamp for iPad from before the handshake: the
    /// link works, unauthenticated, until it is updated.
    @Published private(set) var unauthenticated = false

    private let queue = DispatchQueue(label: "vamp.link.mac")
    private let watcher: UsbMuxWatcher
    private let devicePort: UInt16
    private let pagePort: UInt16
    private var clients: [Int: LinkClient] = [:]
    private var linkedDevices = Set<Int>()
    private var outdatedDevices = Set<Int>()
    private var legacyDevices = Set<Int>()
    /// Read and written on `queue` only, like the clients that use it.
    private let paired = PairedIPads()

    init(config: AppConfig) {
        devicePort = config.padDevicePort
        pagePort = config.padPagePort
        watcher = UsbMuxWatcher(queue: queue)

        if ProcessInfo.processInfo.environment["VAMP_LINK_DIRECT"] == "1" {
            attach(0, serial: nil, dial: UsbMux.loopbackDialer(port: devicePort))
            return
        }
        watcher.onAttach = { [weak self] id, serial in
            Task { @MainActor in
                guard let self else { return }
                VampLog.line("iPad link: an iPad was plugged in")
                self.attach(id, serial: serial, dial: UsbMux.dialer(deviceID: id, port: self.devicePort))
            }
        }
        watcher.log = { VampLog.line("iPad link: \($0)") }
        watcher.onDetach = { [weak self] id in
            Task { @MainActor in self?.detach(id) }
        }
        watcher.start()
    }

    var statusLine: String {
        switch status {
        case .noPad: return "iPad: not plugged in"
        case .padWithoutApp: return "iPad: plugged in, Vamp not open"
        case .needsUpdate: return "iPad: update Vamp for iPad (its link is another version)"
        case .linked: return unauthenticated
            ? "iPad: connected by cable, unauthenticated — update Vamp for iPad"
            : "iPad: connected by cable"
        }
    }

    /// Forget every iPad this Mac has paired with: each pairs again, with a
    /// code, on its next link.
    func forgetPairedIPads() {
        queue.async { [paired] in paired.forgetAll() }
        VampLog.line("iPad link: forgot the paired iPads")
    }

    private func attach(_ id: Int, serial: String?, dial: @escaping LinkDialer) {
        guard clients[id] == nil else { return }
        let paired = paired
        // An iPad that has paired before never gets the unauthenticated
        // link again: another app on it cannot downgrade it.
        let client = LinkClient(
            dial: dial, macPort: pagePort, queue: queue, paired: paired, serial: serial,
            legacyAllowed: { serial.map { !paired.knows(serial: $0) } ?? true }
        )
        client.log = { VampLog.line("iPad link: \($0)") }
        client.onLinkChange = { [weak self] up in
            Task { @MainActor in
                guard let self else { return }
                if up {
                    self.linkedDevices.insert(id)
                    self.outdatedDevices.remove(id)
                } else {
                    self.linkedDevices.remove(id)
                }
                self.refresh()
            }
        }
        client.onIncompatible = { [weak self] _ in
            Task { @MainActor in
                self?.outdatedDevices.insert(id)
                self?.refresh()
            }
        }
        client.onPairingCode = { [weak self] code in
            Task { @MainActor in self?.pairingCode = code }
        }
        client.onLegacy = { [weak self] legacy in
            Task { @MainActor in
                guard let self else { return }
                if legacy { self.legacyDevices.insert(id) } else { self.legacyDevices.remove(id) }
                self.refresh()
            }
        }
        clients[id] = client
        client.start()
        refresh()
    }

    private func detach(_ id: Int) {
        clients.removeValue(forKey: id)?.stop()
        linkedDevices.remove(id)
        outdatedDevices.remove(id)
        legacyDevices.remove(id)
        pairingCode = nil
        VampLog.line("iPad link: the iPad was unplugged")
        refresh()
    }

    private func refresh() {
        unauthenticated = !linkedDevices.intersection(legacyDevices).isEmpty
        if !linkedDevices.isEmpty { status = .linked }
        else if !outdatedDevices.isEmpty { status = .needsUpdate }
        else { status = clients.isEmpty ? .noPad : .padWithoutApp }
    }
}
