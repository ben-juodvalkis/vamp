import AppKit
import ApplicationServices
import CoreMedia
import ScreenCaptureKit

/// What a device's panel shows in Live's window that the LOM does not carry
/// (ADR-541): a needle meter's dB, a spectrum's bands.
///
/// The page asks with `/meter/watch` every couple of seconds while it shows
/// a metered device (`LiveMeterHub` keeps one reader per device); a reader follows its ask and
/// stops 5 s after the asks stop, as `InputMonitor` does. It finds the device
/// in Live's device view through Accessibility
/// (`TrackDeviceChainView.Device[n]`, and `….Device[n].Device[k]` for a
/// device in the chain of a rack's selected pad or chain), checking at each
/// level that the view lists the devices the page means, captures that
/// device of Live's window with ScreenCaptureKit, finds the meter in the
/// picture and reads it (`LiveMeter`: a needle's dB, a spectrum's bands).
///
/// Live must be on the current Space: covered by other windows it still
/// draws, but on another Space it does not (measured 2026-11-16).
final class LiveMeterReader: NSObject, SCStreamOutput, SCStreamDelegate {
    struct Watch: Equatable {
        /// One level of Live's device view, outermost first: the device's
        /// index there and the names of every device at that level, in order.
        struct Level: Equatable {
            var index: Int
            /// nil where the page does not know the device (a pad's instrument).
            var names: [String?]
        }
        var devicePath: String
        /// Live's class name, which picks the meter's kind (`LiveMeter.kinds`).
        var className: String
        /// The track's top-level devices, then (for a device in a rack) the
        /// devices of the pad's or chain's chain Live shows, and so on.
        var levels: [Level]
    }

    /// `(devicePath, dB, status)`: dB −1 unless status is `ok`. Statuses:
    /// `ok`, `not-shown` (Live's device view is not showing that device),
    /// `no-needle` (shown, but no needle in the picture: folded, or Live is
    /// on another Space), `no-meter` (a device this reader has no shape for),
    /// `no-accessibility`, `no-screen-recording`, `no-live`.
    var onReading: ((Reading) -> Void)?

    /// One reading: `kind` is `reduction` (values: one dB) or `spectrum`
    /// (values: `LiveMeter.bandCount` dB on the standard grid); values are
    /// empty unless status is `ok`.
    struct Reading {
        var devicePath: String
        var kind: String
        var values: [Double]
        var status: String
    }

    /// Which Live, when more than one is open: the one Vamp's surface runs in
    /// (it listens on this port). Live 12 and 13 share one bundle identifier.
    var surfacePort: UInt16 = 11022

    static let idleAfter: TimeInterval = 5
    static let fps: Int32 = 30
    /// Pixels per point captured: 1 reads to ±0.35 dB (LiveMeterTests)
    /// at a quarter of 2's pixels.
    static let scale: Double = 1
    /// A reading is sent when it moves this much, or every `heartbeat`.
    static let minimumChange = 0.05
    static let heartbeat: TimeInterval = 0.5
    static let spectrumChange = 0.5
    /// Captured around the device's Accessibility frame, in points.
    static let margin = CGSize(width: 12, height: 40)

    private var watch: Watch?
    private var lastAsk = Date.distantPast
    private var timer: Timer?
    private let axQueue = DispatchQueue(label: "vamp.reduction.ax", qos: .userInitiated)
    private let frameQueue = DispatchQueue(label: "vamp.reduction.frames", qos: .userInitiated)

    // Main thread.
    private var stream: SCStream?
    private var streamWindowID: CGWindowID = 0
    private var sourceRect: CGRect = .zero
    private var starting = false
    private var askedForScreen = false
    private var askedForAccessibility = false

    // axQueue.
    private var chainView: AXUIElement?

    // frameQueue.
    private var kind: LiveMeterKind?
    private var streamingPath = ""
    private var lastSent = (values: [Double](), status: "", at: Date.distantPast)
    /// The Live this reader reads: by pid, with the pids it was chosen among.
    private var livePid: (pid: pid_t, among: Set<pid_t>)?
    private var lastFrameAt = Date.distantPast

    /// The page's ask: read `next`, or stop for nil.
    func keep(_ next: Watch?) {
        lastAsk = Date()
        guard let next else { close(); return }
        if next != watch {
            watch = next
            stopStream()
        }
        if timer == nil {
            timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
        }
        tick()
    }

    func close() {
        timer?.invalidate()
        timer = nil
        watch = nil
        stopStream()
    }

    private func tick() {
        guard let watch else { return }
        if Date().timeIntervalSince(lastAsk) > Self.idleAfter { close(); return }
        guard let kind = LiveMeter.kinds[watch.className] else {
            report(watch.devicePath, "reduction", "no-meter"); return
        }
        if !AXIsProcessTrusted() {
            if !askedForAccessibility {
                askedForAccessibility = true
                let prompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
                _ = AXIsProcessTrustedWithOptions([prompt: true] as CFDictionary)
            }
            report(watch.devicePath, kind.name, "no-accessibility"); return
        }
        if !CGPreflightScreenCaptureAccess() {
            if !askedForScreen { askedForScreen = true; _ = CGRequestScreenCaptureAccess() }
            report(watch.devicePath, kind.name, "no-screen-recording"); return
        }
        axQueue.async { [weak self] in
            guard let self else { return }
            let located = self.locate(watch)
            DispatchQueue.main.async {
                guard self.watch == watch else { return }
                switch located {
                case .failure(let status):
                    self.stopStream()
                    self.report(watch.devicePath, kind.name, status)
                case .success(let device):
                    self.follow(device, kind: kind, watch: watch)
                }
            }
        }
    }

    // MARK: - Finding the device (axQueue)

    private enum Located { case success(CGRect), failure(String) }

    private func locate(_ watch: Watch) -> Located {
        guard let live = liveApp() else { chainView = nil; return .failure("no-live") }
        var devices = chainView.map(Self.devices(in:)) ?? [:]
        if devices.isEmpty {
            chainView = Self.findChainView(AXUIElementCreateApplication(live.processIdentifier))
            devices = chainView.map(Self.devices(in:)) ?? [:]
        }
        guard !watch.levels.isEmpty else { return .failure("not-shown") }
        var parent = "TrackDeviceChainView"
        for level in watch.levels {
            var titles: [String] = []
            while let device = devices["\(parent).Device[\(titles.count)]"] { titles.append(device.title) }
            guard Self.sameDevices(titles, level.names), level.index < titles.count else { return .failure("not-shown") }
            parent = "\(parent).Device[\(level.index)]"
        }
        guard let device = devices[parent] else { return .failure("not-shown") }
        return .success(device.frame)
    }

    /// The Live to read: the only one, or of several the one whose process
    /// listens on Vamp's surface port (asked of `lsof` once per set of Lives).
    private func liveApp() -> NSRunningApplication? {
        let lives = NSWorkspace.shared.runningApplications.filter { $0.bundleIdentifier == "com.ableton.live" }
        guard lives.count > 1 else { livePid = nil; return lives.first }
        let pids = Set(lives.map(\.processIdentifier))
        if let chosen = livePid, chosen.among == pids { return lives.first { $0.processIdentifier == chosen.pid } }
        let lsof = Process()
        lsof.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        lsof.arguments = ["-nP", "-iTCP:\(surfacePort)", "-sTCP:LISTEN", "-t"]
        let out = Pipe()
        lsof.standardOutput = out
        lsof.standardError = FileHandle.nullDevice
        guard (try? lsof.run()) != nil else { return nil }
        lsof.waitUntilExit()
        let listening = Set(String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            .split(whereSeparator: \.isNewline).compactMap { pid_t($0) })
        guard let live = lives.first(where: { listening.contains($0.processIdentifier) }) else { return nil }
        livePid = (live.processIdentifier, pids)
        VampLog.line("live meters: \(lives.count) Lives open; reading pid \(live.processIdentifier), which runs Vamp's surface")
        return live
    }

    /// Live titles a device "name" or, renamed or a rack, "name, type"
    /// ("Chorus, Chorus-Ensemble"); the page knows the name, or nothing (nil)
    /// for a device it holds no record of. Live may show more after them.
    static func sameDevices(_ titles: [String], _ names: [String?]) -> Bool {
        names.count <= titles.count && names.contains { $0 != nil }
            && zip(titles, names).allSatisfy { title, name in
                guard let name else { return true }
                return title == name || title.hasPrefix(name + ", ")
            }
    }

    private static func attribute(_ e: AXUIElement, _ name: String) -> AnyObject? {
        var value: AnyObject?
        return AXUIElementCopyAttributeValue(e, name as CFString, &value) == .success ? value : nil
    }

    /// Live's device view: the element `TrackDeviceChainView`, breadth first.
    private static func findChainView(_ app: AXUIElement) -> AXUIElement? {
        var queue = [app]
        var visited = 0
        while !queue.isEmpty, visited < 5000 {
            let e = queue.removeFirst()
            visited += 1
            if attribute(e, "AXIdentifier") as? String == "TrackDeviceChainView" { return e }
            if let kids = attribute(e, "AXChildren") as? [AXUIElement] { queue.append(contentsOf: kids) }
        }
        return nil
    }

    /// Every device the device view shows, at every depth, by identifier
    /// (`TrackDeviceChainView.Device[0]`, `….Device[0].Device[1]`), with its
    /// title and screen frame.
    private static func devices(in view: AXUIElement) -> [String: (title: String, frame: CGRect)] {
        var found: [String: (title: String, frame: CGRect)] = [:]
        var queue = (attribute(view, "AXChildren") as? [AXUIElement]) ?? []
        var visited = 0
        while !queue.isEmpty, visited < 3000 {
            let e = queue.removeFirst()
            visited += 1
            if let id = attribute(e, "AXIdentifier") as? String, isDeviceIdentifier(id) {
                var point = CGPoint.zero, size = CGSize.zero
                if let p = attribute(e, "AXPosition") { AXValueGetValue(p as! AXValue, .cgPoint, &point) }
                if let s = attribute(e, "AXSize") { AXValueGetValue(s as! AXValue, .cgSize, &size) }
                found[id] = ((attribute(e, "AXTitle") as? String) ?? "", CGRect(origin: point, size: size))
            }
            if let kids = attribute(e, "AXChildren") as? [AXUIElement] { queue.append(contentsOf: kids) }
        }
        return found
    }

    /// `TrackDeviceChainView` followed by one or more `.Device[n]`, and nothing else.
    static func isDeviceIdentifier(_ id: String) -> Bool {
        guard id.hasPrefix("TrackDeviceChainView.Device[") else { return false }
        var rest = Substring(id.dropFirst("TrackDeviceChainView".count))
        while !rest.isEmpty {
            guard rest.hasPrefix(".Device["), let close = rest.firstIndex(of: "]") else { return false }
            let digits = rest[rest.index(rest.startIndex, offsetBy: ".Device[".count)..<close]
            guard !digits.isEmpty, digits.allSatisfy(\.isNumber) else { return false }
            rest = rest[rest.index(after: close)...]
        }
        return true
    }

    // MARK: - Capturing (main thread)

    /// The Live being read (set by `liveApp` on the AX queue; a plain read is fine).
    private var livePidNow: pid_t? {
        livePid?.pid ?? NSWorkspace.shared.runningApplications.first { $0.bundleIdentifier == "com.ableton.live" }?.processIdentifier
    }

    private func follow(_ device: CGRect, kind: LiveMeterKind, watch: Watch) {
        if stream != nil {
            // Frames stop when Live is on another Space; say so rather than hold the last value.
            frameQueue.async { [weak self] in
                guard let self, Date().timeIntervalSince(self.lastFrameAt) > 1.5 else { return }
                self.send(watch.devicePath, kind.name, [], "no-needle")
            }
        }
        guard !starting else { return }
        starting = true
        Task { @MainActor in
            defer { self.starting = false }
            guard let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false),
                  let window = content.windows
                    .filter({ $0.owningApplication?.processID == self.livePidNow && $0.windowLayer == 0 && $0.frame.contains(device) })
                    .max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
            else { self.stopStream(); self.report(watch.devicePath, kind.name, "not-shown"); return }
            // The device and a margin: ScreenCaptureKit's window coordinates and
            // Accessibility's can differ by the window's origin (33 pt in a
            // full-height window), so the panel is found in the picture.
            let rect = CGRect(
                x: device.minX - window.frame.minX - Self.margin.width,
                y: device.minY - window.frame.minY - Self.margin.height,
                width: device.width + 2 * Self.margin.width,
                height: device.height + 2 * Self.margin.height)
                .intersection(CGRect(origin: .zero, size: window.frame.size))
            if self.stream != nil, window.windowID == self.streamWindowID, rect == self.sourceRect { return }
            let config = SCStreamConfiguration()
            config.sourceRect = rect
            config.width = Int(rect.width * Self.scale)
            config.height = Int(rect.height * Self.scale)
            config.pixelFormat = kCVPixelFormatType_32BGRA
            config.minimumFrameInterval = CMTime(value: 1, timescale: Self.fps)
            config.showsCursor = false
            config.queueDepth = 3
            do {
                if let stream = self.stream, window.windowID == self.streamWindowID {
                    try await stream.updateConfiguration(config)
                } else {
                    self.stopStream()
                    let stream = SCStream(filter: SCContentFilter(desktopIndependentWindow: window), configuration: config, delegate: self)
                    try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: self.frameQueue)
                    try await stream.startCapture()
                    self.stream = stream
                    self.streamWindowID = window.windowID
                }
                // After any stop above: its clear is queued on frameQueue ahead of this.
                self.frameQueue.async { self.kind = kind; self.streamingPath = watch.devicePath }
                if rect != self.sourceRect {
                    VampLog.line("live meters: reading \(watch.className) at \(watch.devicePath), \(rect)")
                }
                self.sourceRect = rect
            } catch {
                VampLog.line("live meters: capture failed: \(error.localizedDescription)")
                self.stopStream()
            }
        }
    }

    private func stopStream() {
        if let stream { Task { try? await stream.stopCapture() } }
        stream = nil
        streamWindowID = 0
        sourceRect = .zero
        frameQueue.async { [weak self] in self?.streamingPath = ""; self?.kind = nil }
    }

    // MARK: - Frames (frameQueue)

    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, let kind, !streamingPath.isEmpty, let image = buffer.imageBuffer else { return }
        lastFrameAt = Date()
        CVPixelBufferLockBaseAddress(image, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(image, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(image) else { return }
        let pixels = base.assumingMemoryBound(to: UInt8.self)
        let width = CVPixelBufferGetWidth(image), height = CVPixelBufferGetHeight(image)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(image)
        let values: [Double]?
        switch kind {
        case .needle(let shape):
            values = LiveMeter.reading(pixels: pixels, width: width, height: height, bytesPerRow: bytesPerRow,
                                       scale: Self.scale, shape: shape).map { [($0 * 100).rounded() / 100] }
        case .spectrum(let shape):
            values = LiveMeter.spectrum(pixels: pixels, width: width, height: height, bytesPerRow: bytesPerRow,
                                        scale: Self.scale, shape: shape)
        }
        if let values { send(streamingPath, kind.name, values, "ok") } else { send(streamingPath, kind.name, [], "no-needle") }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        VampLog.line("live meters: capture stopped: \(error.localizedDescription)")
        DispatchQueue.main.async { [weak self] in
            guard let self, self.stream === stream else { return }
            self.stream = nil
            self.streamWindowID = 0
            self.sourceRect = .zero
        }
    }

    /// On frameQueue: send if it changed enough (a needle by 0.05 dB, any
    /// spectrum band by 0.5 dB), its status changed, or the heartbeat is due.
    private func send(_ path: String, _ kind: String, _ values: [Double], _ status: String) {
        let now = Date()
        let threshold = kind == "spectrum" ? Self.spectrumChange : Self.minimumChange
        let moved = status != lastSent.status || values.count != lastSent.values.count
            || zip(values, lastSent.values).contains { abs($0 - $1) >= threshold }
        guard moved || now.timeIntervalSince(lastSent.at) >= Self.heartbeat else { return }
        lastSent = (values, status, now)
        let reading = Reading(devicePath: path, kind: kind, values: values, status: status)
        DispatchQueue.main.async { [weak self] in self?.onReading?(reading) }
    }

    /// On the main thread, for statuses found outside a frame.
    private func report(_ path: String, _ kind: String, _ status: String) {
        frameQueue.async { [weak self] in self?.send(path, kind, [], status) }
    }
}

/// Every device the page asks about, each read by its own `LiveMeterReader`
/// on its own capture stream (ADR-542): the chain shows several metered
/// devices at once. Each reader stops 5 s after its own last ask; an empty
/// ask stops them all.
final class LiveMeterHub {
    var onReading: ((LiveMeterReader.Reading) -> Void)?
    var surfacePort: UInt16 = 11022
    private var readers: [String: (reader: LiveMeterReader, lastAsk: Date)] = [:]
    private var sweep: Timer?

    func keep(_ watch: LiveMeterReader.Watch?) {
        guard let watch else { close(); return }
        let reader: LiveMeterReader
        if let existing = readers[watch.devicePath] {
            reader = existing.reader
        } else {
            reader = LiveMeterReader()
            reader.surfacePort = surfacePort
            reader.onReading = { [weak self] in self?.onReading?($0) }
        }
        readers[watch.devicePath] = (reader, Date())
        reader.keep(watch)
        if sweep == nil {
            sweep = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.forgetIdle() }
        }
    }

    func close() {
        for entry in readers.values { entry.reader.close() }
        readers.removeAll()
        sweep?.invalidate()
        sweep = nil
    }

    /// Drop the readers the page stopped asking about (each has closed itself).
    private func forgetIdle() {
        let now = Date()
        for (path, entry) in readers where now.timeIntervalSince(entry.lastAsk) > LiveMeterReader.idleAfter + 1 {
            entry.reader.close()
            readers[path] = nil
        }
        if readers.isEmpty { sweep?.invalidate(); sweep = nil }
    }
}
