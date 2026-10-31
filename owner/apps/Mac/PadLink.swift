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

    private let queue = DispatchQueue(label: "vamp.link.mac")
    private let watcher: UsbMuxWatcher
    private let devicePort: UInt16
    private let pagePort: UInt16
    private var clients: [Int: LinkClient] = [:]
    private var linkedDevices = Set<Int>()
    private var outdatedDevices = Set<Int>()

    init(config: AppConfig) {
        devicePort = config.padDevicePort
        pagePort = config.padPagePort
        watcher = UsbMuxWatcher(queue: queue)

        if ProcessInfo.processInfo.environment["VAMP_LINK_DIRECT"] == "1" {
            attach(0, dial: UsbMux.loopbackDialer(port: devicePort))
            return
        }
        watcher.onAttach = { [weak self] id in
            Task { @MainActor in
                guard let self else { return }
                VampLog.line("iPad link: an iPad was plugged in")
                self.attach(id, dial: UsbMux.dialer(deviceID: id, port: self.devicePort))
            }
        }
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
        case .linked: return "iPad: connected by cable"
        }
    }

    private func attach(_ id: Int, dial: @escaping LinkDialer) {
        guard clients[id] == nil else { return }
        let client = LinkClient(dial: dial, macPort: pagePort, queue: queue)
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
        clients[id] = client
        client.start()
        refresh()
    }

    private func detach(_ id: Int) {
        clients.removeValue(forKey: id)?.stop()
        linkedDevices.remove(id)
        outdatedDevices.remove(id)
        VampLog.line("iPad link: the iPad was unplugged")
        refresh()
    }

    private func refresh() {
        if !linkedDevices.isEmpty { status = .linked }
        else if !outdatedDevices.isEmpty { status = .needsUpdate }
        else { status = clients.isEmpty ? .noPad : .padWithoutApp }
    }
}
