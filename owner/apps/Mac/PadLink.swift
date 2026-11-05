import Foundation
import Network

/// Vamp for iPad, from the Mac's side: follows the iPad on the USB cable
/// and keeps a `LinkClient` to its app while it is plugged in; and, since
/// ADR-504, finds paired iPads on the network with Bonjour and keeps one
/// to each of those too. The iPad decides which carries a new connection
/// (the cable, when both are up).
///
/// An iPad on Wi-Fi is dialled only when its advertised key id is one this
/// Mac paired with, over TLS keyed by that key; it is never paired there
/// and never given the unauthenticated link.
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
    /// How the linked iPads are connected (ADR-504).
    @Published private(set) var byCable = false
    @Published private(set) var overWifi = false

    private let queue = DispatchQueue(label: "vamp.link.mac")
    private let watcher: UsbMuxWatcher
    private let devicePort: UInt16
    private let pagePort: UInt16
    private var clients: [Int: LinkClient] = [:]
    private var linkedDevices = Set<Int>()
    private var outdatedDevices = Set<Int>()
    private var legacyDevices = Set<Int>()
    /// iPads on Wi-Fi, by their key's id: the Bonjour results seen, the
    /// clients dialling the paired ones, and the linked ones.
    private var wifiBrowser: NWBrowser?
    private var wifiSeen: [String: NWEndpoint] = [:]
    private var wifiClients: [String: LinkClient] = [:]
    private var wifiLinked = Set<String>()
    /// Said once per iPad: one on Wi-Fi this Mac has not paired with.
    private var wifiUnpairedSaid = Set<String>()
    /// Read and written on `queue` only, like the clients that use it.
    private let paired = PairedIPads()

    init(config: AppConfig) {
        devicePort = config.padDevicePort
        pagePort = config.padPagePort
        watcher = UsbMuxWatcher(queue: queue)

        startWifiBrowser()
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
        case .linked:
            if unauthenticated { return "iPad: connected by cable, unauthenticated — update Vamp for iPad" }
            switch (byCable, overWifi) {
            case (true, true): return "iPad: connected by cable and Wi-Fi"
            case (false, true): return "iPad: connected over Wi-Fi"
            default: return "iPad: connected by cable"
            }
        }
    }

    /// Forget every iPad this Mac has paired with: each pairs again, with a
    /// code, on its next link.
    func forgetPairedIPads() {
        queue.async { [paired] in paired.forgetAll() }
        VampLog.line("iPad link: forgot the paired iPads")
        for id in Array(wifiClients.keys) { detachWifi(id) }
        wifiUnpairedSaid.removeAll()
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
                    // It may have just paired: an iPad already seen on
                    // Wi-Fi can be dialled there now.
                    self.reconcileWifi()
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

    // MARK: - Wi-Fi (ADR-504)

    private func startWifiBrowser() {
        let params = NWParameters()
        params.includePeerToPeer = false
        let browser = NWBrowser(for: .bonjourWithTXTRecord(type: LinkProtocol.bonjourType, domain: nil), using: params)
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            var seen: [String: NWEndpoint] = [:]
            for result in results {
                guard case .bonjour(let txt) = result.metadata, let keyId = txt[LinkProtocol.txtKeyId] else { continue }
                if seen[keyId] == nil { seen[keyId] = result.endpoint }
            }
            Task { @MainActor in
                self?.wifiSeen = seen
                self?.reconcileWifi()
            }
        }
        browser.stateUpdateHandler = { state in
            if case .failed(let error) = state { VampLog.line("iPad link: browsing Wi-Fi failed (\(error))") }
        }
        browser.start(queue: queue)
        wifiBrowser = browser
    }

    /// Dial each paired iPad seen on Wi-Fi; stop dialling one that has gone.
    private func reconcileWifi() {
        let seen = wifiSeen
        queue.async { [weak self, paired] in
            var keys: [String: LinkKey] = [:]
            for id in seen.keys { keys[id] = paired.key(for: id) }
            Task { @MainActor in
                guard let self else { return }
                for id in Array(self.wifiClients.keys) where keys[id] == nil || seen[id] == nil {
                    self.detachWifi(id)
                }
                for (id, endpoint) in seen {
                    guard let key = keys[id] else {
                        if self.wifiUnpairedSaid.insert(id).inserted {
                            VampLog.line("iPad link: an iPad on Wi-Fi this Mac has not paired with (plug it in once to pair)")
                        }
                        continue
                    }
                    if self.wifiClients[id] == nil { self.attachWifi(id, endpoint: endpoint, key: key) }
                }
            }
        }
    }

    private func attachWifi(_ id: String, endpoint: NWEndpoint, key: LinkKey) {
        VampLog.line("iPad link: a paired iPad is on Wi-Fi")
        let client = LinkClient(
            dial: UsbMux.networkDialer(to: endpoint, using: { .wifiLink(key: key) }),
            macPort: pagePort, queue: queue, paired: paired,
            legacyAllowed: { false }, allowPairing: false
        )
        client.slowAfterShortLink = true
        client.log = { VampLog.line("iPad link (Wi-Fi): \($0)") }
        client.onLinkChange = { [weak self] up in
            Task { @MainActor in
                guard let self, self.wifiClients[id] === client else { return }
                if up { self.wifiLinked.insert(id) } else { self.wifiLinked.remove(id) }
                self.refresh()
            }
        }
        wifiClients[id] = client
        client.start()
    }

    private func detachWifi(_ id: String) {
        guard let client = wifiClients.removeValue(forKey: id) else { return }
        client.stop()
        if wifiLinked.remove(id) != nil { VampLog.line("iPad link: the iPad left Wi-Fi") }
        refresh()
    }

    private func refresh() {
        unauthenticated = !linkedDevices.intersection(legacyDevices).isEmpty
        byCable = !linkedDevices.isEmpty
        overWifi = !wifiLinked.isEmpty
        if !linkedDevices.isEmpty || !wifiLinked.isEmpty { status = .linked }
        else if !outdatedDevices.isEmpty { status = .needsUpdate }
        else { status = clients.isEmpty ? .noPad : .padWithoutApp }
    }
}
