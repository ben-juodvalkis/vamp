// demo-recorder: the demo runner's eyes, ears and keyboard.
//
//   demo-recorder list
//       Every window ScreenCaptureKit can see, as one JSON array.
//   demo-recorder record --out <file.mov> --window <id> [--window <id> …]
//                        [--audio-pid <pid>] [--fps 60] [--midi "Vamp Demo"]
//       Records each window as its own video track and the process's audio
//       as an audio track, into ONE file on the host clock, so the tracks
//       are in sync by construction. Opens a virtual MIDI source for the
//       scenario's phrase. Commands arrive on stdin, one JSON object a line:
//         {"cmd":"midi","events":[{"inMs":0,"bytes":[144,60,100]}, …]}
//         {"cmd":"mark","label":"…"}      → {"event":"mark","t":<s into file>}
//         {"cmd":"stop"}
//       Events leave on stdout, one JSON object a line.
//   demo-recorder midi [--midi "Vamp Demo"]
//       The MIDI port and the stdin commands alone, with no capture (and so
//       no Screen Recording permission): for trying the phrase on its own.
//
// Built by scripts/demo/recorder.mjs into scripts/.cache/demo/.

import AppKit
import AVFoundation
import CoreGraphics
import CoreMIDI
import Foundation
import QuartzCore
import ScreenCaptureKit

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func fail(_ message: String) -> Never {
    emit(["event": "error", "message": message])
    exit(1)
}

let args = Array(CommandLine.arguments.dropFirst())

func option(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

func options(_ name: String) -> [String] {
    var found: [String] = []
    var i = 0
    while i < args.count {
        if args[i] == name, i + 1 < args.count { found.append(args[i + 1]); i += 2 } else { i += 1 }
    }
    return found
}

func even(_ v: CGFloat) -> Int { max(2, Int(v.rounded()) & ~1) }

// MARK: - MIDI

/// A virtual MIDI source. Live lists it as an input port like any keyboard.
final class MidiSource {
    private var client = MIDIClientRef()
    private var source = MIDIEndpointRef()
    /// (host time, message), kept sorted; played by `run` on its own thread.
    private var pending: [(at: UInt64, bytes: [UInt8])] = []
    private let condition = NSCondition()
    private let ticksPerMs: Double = {
        var tb = mach_timebase_info_data_t()
        mach_timebase_info(&tb)
        return 1_000_000 * Double(tb.denom) / Double(tb.numer)
    }()

    init(name: String) {
        guard MIDIClientCreate(name as CFString, nil, nil, &client) == noErr,
              MIDISourceCreate(client, name as CFString, &source) == noErr
        else { fail("could not create the MIDI source \"\(name)\"") }
        let thread = Thread { [unowned self] in self.run() }
        thread.qualityOfService = .userInteractive
        thread.start()
    }

    /// Messages due together leave as ONE packet list, a packet each: a
    /// chord is one delivery, not four racing ones.
    func send(_ messages: [[UInt8]]) {
        let size = 64 + messages.reduce(0) { $0 + $1.count + 16 }
        let raw = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: 8)
        defer { raw.deallocate() }
        let list = raw.bindMemory(to: MIDIPacketList.self, capacity: 1)
        var packet: UnsafeMutablePointer<MIDIPacket>? = MIDIPacketListInit(list)
        // Stamped with the host time, not 0 ("now"): Live 12.4 recorded
        // 0-stamped notes for a while and then silently dropped every one
        // (2026-09-28); host-stamped ones it always records.
        let now = mach_absolute_time()
        for bytes in messages {
            guard let p = packet else { break }
            packet = MIDIPacketListAdd(list, size, p, now, bytes.count, bytes)
        }
        MIDIReceived(source, list)
    }

    /// Each event fires `inMs` after this call. Dispatch timers may fire
    /// ~10% late (timer coalescing), which drifts a phrase off the beat,
    /// so a dedicated thread waits for each host time instead.
    func schedule(_ events: [[String: Any]]) {
        let now = mach_absolute_time()
        condition.lock()
        for event in events {
            guard let bytes = (event["bytes"] as? [Int])?.map({ UInt8(truncatingIfNeeded: $0) }) else { continue }
            let ms = max(0, (event["inMs"] as? Double) ?? 0)
            pending.append((now + UInt64(ms * ticksPerMs), bytes))
        }
        pending.sort { $0.at < $1.at }
        condition.signal()
        condition.unlock()
    }

    private func run() {
        while true {
            condition.lock()
            while pending.isEmpty { condition.wait() }
            let due = pending[0].at
            let now = mach_absolute_time()
            if due > now {
                let ms = Double(due - now) / ticksPerMs
                if ms > 3 {
                    // Coarse sleep, woken early by a newly scheduled event.
                    _ = condition.wait(until: Date(timeIntervalSinceNow: (ms - 2) / 1000))
                    condition.unlock()
                } else {
                    condition.unlock()
                    mach_wait_until(due)
                }
                continue
            }
            var batch: [[UInt8]] = []
            let cutoff = mach_absolute_time()
            while let first = pending.first, first.at <= cutoff {
                batch.append(pending.removeFirst().bytes)
            }
            condition.unlock()
            send(batch)
        }
    }

    /// All notes off on every channel: no note outlives the run.
    func panic() {
        condition.lock()
        pending.removeAll()
        condition.unlock()
        send((0..<16).map { [UInt8(0xB0 | $0), 123, 0] })
    }
}

// MARK: - Capture

final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
    private let writer: AVAssetWriter
    private let queue = DispatchQueue(label: "demo.capture", qos: .userInteractive)
    private var streams: [SCStream] = []
    private var videoInputs: [ObjectIdentifier: AVAssetWriterInput] = [:]
    private var audioStream: ObjectIdentifier?
    private var audioInput: AVAssetWriterInput?
    private var sessionStart: CMTime?
    private var frames: [ObjectIdentifier: Int] = [:]
    private var dropped = 0
    private var audioBuffers = 0

    init(out: URL) {
        try? FileManager.default.removeItem(at: out)
        guard let w = try? AVAssetWriter(outputURL: out, fileType: .mov) else { fail("cannot write \(out.path)") }
        writer = w
    }

    func addWindow(_ window: SCWindow, fps: Int) throws {
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let scale = CGFloat(filter.pointPixelScale)
        let config = SCStreamConfiguration()
        config.width = even(filter.contentRect.width * scale)
        config.height = even(filter.contentRect.height * scale)
        config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.showsCursor = false
        config.queueDepth = 8
        config.ignoreShadowsSingleWindow = true

        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: config.width,
            AVVideoHeightKey: config.height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: config.width * config.height * 12,
                AVVideoExpectedSourceFrameRateKey: fps,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
            ],
        ])
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else { throw NSError(domain: "demo", code: 1) }
        writer.add(input)

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        videoInputs[ObjectIdentifier(stream)] = input
        streams.append(stream)
        emit(["event": "track", "kind": "video", "windowId": window.windowID,
              "app": window.owningApplication?.applicationName ?? "", "title": window.title ?? "",
              "width": config.width, "height": config.height, "scale": scale])
    }

    /// The process's own audio. ScreenCaptureKit filters audio by the
    /// applications in the content filter, so a display filter holding only
    /// this app hears only it. The stream's video is a token 64×64 at 1 fps
    /// that is thrown away.
    func addAudio(app: SCRunningApplication, display: SCDisplay) throws {
        let filter = SCContentFilter(display: display, including: [app], exceptingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = 48_000
        config.channelCount = 2
        config.excludesCurrentProcessAudio = true
        config.width = 64
        config.height = 64
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: 48_000,
            AVNumberOfChannelsKey: 2,
            AVLinearPCMBitDepthKey: 24,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
        ])
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else { throw NSError(domain: "demo", code: 2) }
        writer.add(input)

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        audioStream = ObjectIdentifier(stream)
        audioInput = input
        streams.append(stream)
        emit(["event": "track", "kind": "audio", "app": app.applicationName, "pid": app.processID])
    }

    func start() async throws {
        guard writer.startWriting() else { fail("writer: \(writer.error?.localizedDescription ?? "unknown")") }
        for stream in streams { try await stream.startCapture() }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard buffer.isValid else { return }
        let id = ObjectIdentifier(stream)
        switch type {
        case .screen:
            guard let input = videoInputs[id] else { return } // the audio stream's token video
            // Idle and blank frames carry no image: only complete ones are frames.
            guard let attachments = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false)
                    as? [[SCStreamFrameInfo: Any]],
                  let raw = attachments.first?[.status] as? Int,
                  SCFrameStatus(rawValue: raw) == .complete
            else { return }
            if append(buffer, to: input) { frames[id, default: 0] += 1 }
        case .audio:
            guard id == audioStream, let input = audioInput else { return }
            if append(buffer, to: input) { audioBuffers += 1 }
        default:
            return
        }
    }

    /// The first sample from any track opens the session at its own time,
    /// which every track shares: all of them are stamped on the host clock.
    private func append(_ buffer: CMSampleBuffer, to input: AVAssetWriterInput) -> Bool {
        let pts = CMSampleBufferGetPresentationTimeStamp(buffer)
        if sessionStart == nil {
            writer.startSession(atSourceTime: pts)
            sessionStart = pts
            emit(["event": "started", "hostTime": pts.seconds, "now": CACurrentMediaTime()])
        }
        guard input.isReadyForMoreMediaData else { dropped += 1; return false }
        return input.append(buffer)
    }

    /// Seconds into the file, on the same clock the tracks are stamped with.
    func fileTime() -> Double? {
        queue.sync { sessionStart.map { CACurrentMediaTime() - $0.seconds } }
    }

    func stop() async {
        for stream in streams { try? await stream.stopCapture() }
        queue.sync {
            for input in videoInputs.values { input.markAsFinished() }
            audioInput?.markAsFinished()
        }
        if sessionStart == nil {
            writer.cancelWriting()
            fail("nothing was captured: no frame and no audio arrived")
        }
        await writer.finishWriting()
        let perWindow = streams.compactMap { s -> Int? in
            videoInputs[ObjectIdentifier(s)] == nil ? nil : frames[ObjectIdentifier(s), default: 0]
        }
        emit(["event": "stopped", "file": writer.outputURL.path, "status": writer.status.rawValue,
              "error": writer.error?.localizedDescription ?? "", "framesPerWindow": perWindow,
              "audioBuffers": audioBuffers, "dropped": dropped])
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        emit(["event": "error", "message": "capture stopped: \(error.localizedDescription)"])
    }
}

// MARK: - stdin commands

func readCommands(_ handle: @escaping ([String: Any]) -> Void) {
    var pending = Data()
    FileHandle.standardInput.readabilityHandler = { fh in
        let chunk = fh.availableData
        if chunk.isEmpty { // stdin closed: the runner is gone, so stop
            FileHandle.standardInput.readabilityHandler = nil
            handle(["cmd": "stop"])
            return
        }
        pending.append(chunk)
        while let nl = pending.firstIndex(of: 0x0A) {
            let line = pending.subdata(in: pending.startIndex..<nl)
            pending.removeSubrange(pending.startIndex...nl)
            if let obj = try? JSONSerialization.jsonObject(with: line) as? [String: Any] { handle(obj) }
        }
    }
}

// MARK: - main

func requireScreenRecording() {
    if !CGPreflightScreenCaptureAccess() {
        CGRequestScreenCaptureAccess()
        fail("Screen Recording is not granted to the app that launched this (System Settings → Privacy & Security → Screen Recording), then run again")
    }
}

func listWindows() async {
    requireScreenRecording()
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
        let rows: [[String: Any]] = content.windows.map { w in
            [
                "id": w.windowID,
                "pid": w.owningApplication?.processID ?? 0,
                "app": w.owningApplication?.applicationName ?? "",
                "bundle": w.owningApplication?.bundleIdentifier ?? "",
                "title": w.title ?? "",
                "onScreen": w.isOnScreen,
                "layer": w.windowLayer,
                "frame": [w.frame.origin.x, w.frame.origin.y, w.frame.width, w.frame.height],
            ]
        }
        let data = try JSONSerialization.data(withJSONObject: rows, options: [.sortedKeys])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
        exit(0)
    } catch {
        fail("could not list windows: \(error.localizedDescription)")
    }
}

func record() async {
    requireScreenRecording()
    guard let out = option("--out") else { fail("record needs --out <file.mov>") }
    let windowIds = options("--window").compactMap { UInt32($0) }
    guard !windowIds.isEmpty else { fail("record needs at least one --window <id>") }
    let fps = Int(option("--fps") ?? "60") ?? 60
    let midi = MidiSource(name: option("--midi") ?? "Vamp Demo")

    let content: SCShareableContent
    do {
        content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
    } catch {
        fail("could not read shareable content: \(error.localizedDescription)")
    }

    let recorder = Recorder(out: URL(fileURLWithPath: out))
    do {
        for id in windowIds {
            guard let w = content.windows.first(where: { $0.windowID == id }) else { fail("no window \(id)") }
            try recorder.addWindow(w, fps: fps)
        }
        if let pidText = option("--audio-pid"), let pid = pid_t(pidText) {
            guard let app = content.applications.first(where: { $0.processID == pid }) else {
                fail("no running application with pid \(pid)")
            }
            guard let display = content.displays.first else { fail("no display") }
            try recorder.addAudio(app: app, display: display)
        }
        try await recorder.start()
    } catch {
        fail("could not start capture: \(error.localizedDescription)")
    }
    emit(["event": "recording"])

    var stopping = false
    let stop = {
        if stopping { return }
        stopping = true
        midi.panic()
        Task {
            await recorder.stop()
            exit(0)
        }
    }
    signal(SIGINT, SIG_IGN)
    let sigint = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
    sigint.setEventHandler(handler: stop)
    sigint.resume()

    readCommands { cmd in
        switch cmd["cmd"] as? String {
        case "midi":
            midi.schedule((cmd["events"] as? [[String: Any]]) ?? [])
        case "mark":
            emit(["event": "mark", "label": cmd["label"] ?? "", "t": recorder.fileTime() ?? -1])
        case "stop":
            DispatchQueue.main.async(execute: stop)
        default:
            emit(["event": "error", "message": "unknown command \(cmd)"])
        }
    }
    withExtendedLifetime(sigint) {}
}

func midiOnly() {
    let midi = MidiSource(name: option("--midi") ?? "Vamp Demo")
    emit(["event": "ready"])
    readCommands { cmd in
        switch cmd["cmd"] as? String {
        case "midi": midi.schedule((cmd["events"] as? [[String: Any]]) ?? [])
        case "stop":
            midi.panic()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { exit(0) }
        default: break
        }
    }
}

switch args.first {
case "list": Task { await listWindows() }
case "record":
    // A capture stream needs a window-server connection, which a bare CLI
    // never makes (CGS_REQUIRE_INIT asserts). An app with no Dock icon has one.
    NSApplication.shared.setActivationPolicy(.prohibited)
    Task { await record() }
case "midi": midiOnly()
default:
    FileHandle.standardError.write(Data("usage: demo-recorder list | record --out <f.mov> --window <id>… [--audio-pid <pid>] [--fps n] [--midi name] | midi\n".utf8))
    exit(2)
}
dispatchMain()
