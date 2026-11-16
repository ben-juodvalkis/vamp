import AppKit
import ApplicationServices
import CoreMedia
import ScreenCaptureKit

/// The gain reduction a device's meter shows in Live's window (ADR-541).
///
/// The page asks with `/meter/reduction/watch` every couple of seconds while
/// it shows a device that has a meter; the reader follows the latest ask and
/// stops 5 s after the asks stop, as `InputMonitor` does. It finds the device
/// in Live's device view through Accessibility
/// (`TrackDeviceChainView.Device[n]`, and `….Device[n].Device[k]` for a
/// device in the chain of a rack's selected pad or chain), checking at each
/// level that the view lists the devices the page means, captures that
/// device of Live's window with ScreenCaptureKit, finds the meter in the
/// picture and reads the needle (`ReductionMeter`).
///
/// Live must be on the current Space: covered by other windows it still
/// draws, but on another Space it does not (measured 2026-11-16).
final class ReductionReader: NSObject, SCStreamOutput, SCStreamDelegate {
    struct Watch: Equatable {
        /// One level of Live's device view, outermost first: the device's
        /// index there and the names of every device at that level, in order.
        struct Level: Equatable {
            var index: Int
            /// nil where the page does not know the device (a pad's instrument).
            var names: [String?]
        }
        var devicePath: String
        /// Live's class name, which picks the meter's shape.
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
    var onReading: ((String, Double, String) -> Void)?

    static let idleAfter: TimeInterval = 5
    static let fps: Int32 = 30
    /// Pixels per point captured: 1 reads to ±0.35 dB (ReductionMeterTests)
    /// at a quarter of 2's pixels.
    static let scale: Double = 1
    /// A reading is sent when it moves this much, or every `heartbeat`.
    static let minimumChange = 0.05
    static let heartbeat: TimeInterval = 0.5
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
    private var shape: ReductionMeterShape?
    private var streamingPath = ""
    private var lastSent = (db: -2.0, status: "", at: Date.distantPast)
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
        guard let shape = ReductionMeter.shapes[watch.className] else {
            report(watch.devicePath, -1, "no-meter"); return
        }
        if !AXIsProcessTrusted() {
            if !askedForAccessibility {
                askedForAccessibility = true
                let prompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
                _ = AXIsProcessTrustedWithOptions([prompt: true] as CFDictionary)
            }
            report(watch.devicePath, -1, "no-accessibility"); return
        }
        if !CGPreflightScreenCaptureAccess() {
            if !askedForScreen { askedForScreen = true; _ = CGRequestScreenCaptureAccess() }
            report(watch.devicePath, -1, "no-screen-recording"); return
        }
        axQueue.async { [weak self] in
            guard let self else { return }
            let located = self.locate(watch)
            DispatchQueue.main.async {
                guard self.watch == watch else { return }
                switch located {
                case .failure(let status):
                    self.stopStream()
                    self.report(watch.devicePath, -1, status)
                case .success(let device):
                    self.follow(device, shape: shape, watch: watch)
                }
            }
        }
    }

    // MARK: - Finding the device (axQueue)

    private enum Located { case success(CGRect), failure(String) }

    private func locate(_ watch: Watch) -> Located {
        guard let live = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == "com.ableton.live" })
        else { chainView = nil; return .failure("no-live") }
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

    private func follow(_ device: CGRect, shape: ReductionMeterShape, watch: Watch) {
        if stream != nil {
            // Frames stop when Live is on another Space; say so rather than hold the last value.
            frameQueue.async { [weak self] in
                guard let self, Date().timeIntervalSince(self.lastFrameAt) > 1.5 else { return }
                self.send(watch.devicePath, -1, "no-needle", force: false)
            }
        }
        guard !starting else { return }
        starting = true
        Task { @MainActor in
            defer { self.starting = false }
            guard let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false),
                  let window = content.windows
                    .filter({ $0.owningApplication?.bundleIdentifier == "com.ableton.live" && $0.windowLayer == 0 && $0.frame.contains(device) })
                    .max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
            else { self.stopStream(); self.report(watch.devicePath, -1, "not-shown"); return }
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
                self.frameQueue.async { self.shape = shape; self.streamingPath = watch.devicePath }
                if rect != self.sourceRect {
                    VampLog.line("reduction: reading \(watch.className) at \(watch.devicePath), \(rect)")
                }
                self.sourceRect = rect
            } catch {
                VampLog.line("reduction: capture failed: \(error.localizedDescription)")
                self.stopStream()
            }
        }
    }

    private func stopStream() {
        if let stream { Task { try? await stream.stopCapture() } }
        stream = nil
        streamWindowID = 0
        sourceRect = .zero
        frameQueue.async { [weak self] in self?.streamingPath = ""; self?.shape = nil }
    }

    // MARK: - Frames (frameQueue)

    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, let shape, !streamingPath.isEmpty, let image = buffer.imageBuffer else { return }
        lastFrameAt = Date()
        CVPixelBufferLockBaseAddress(image, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(image, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(image) else { return }
        let db = ReductionMeter.reading(
            pixels: base.assumingMemoryBound(to: UInt8.self),
            width: CVPixelBufferGetWidth(image), height: CVPixelBufferGetHeight(image),
            bytesPerRow: CVPixelBufferGetBytesPerRow(image), scale: Self.scale, shape: shape)
        if let db { send(streamingPath, db, "ok", force: false) } else { send(streamingPath, -1, "no-needle", force: false) }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        VampLog.line("reduction: capture stopped: \(error.localizedDescription)")
        DispatchQueue.main.async { [weak self] in
            guard let self, self.stream === stream else { return }
            self.stream = nil
            self.streamWindowID = 0
            self.sourceRect = .zero
        }
    }

    /// On frameQueue: send if it changed enough, or the heartbeat is due.
    private func send(_ path: String, _ db: Double, _ status: String, force: Bool) {
        let now = Date()
        let moved = abs(db - lastSent.db) >= Self.minimumChange || status != lastSent.status
        guard force || moved || now.timeIntervalSince(lastSent.at) >= Self.heartbeat else { return }
        lastSent = (db, status, now)
        let rounded = (db * 100).rounded() / 100
        DispatchQueue.main.async { [weak self] in self?.onReading?(path, rounded, status) }
    }

    /// On the main thread, for statuses found outside a frame.
    private func report(_ path: String, _ db: Double, _ status: String) {
        frameQueue.async { [weak self] in self?.send(path, db, status, force: false) }
    }
}
