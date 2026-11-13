import AVFoundation
import CoreAudio
import Foundation
import os

/// Live levels of every input on one device, for Settings → Capture's meters
/// (ADR-533). The page asks for a device with `/capture/input/monitor <uid>`
/// every couple of seconds while the picker is on screen; the monitor follows
/// the latest ask and closes the device once the asks stop, so a page that
/// goes away cannot leave the Mac listening.
///
/// It is also where macOS's microphone prompt comes from: the first ask finds
/// the permission undecided and requests it, so the prompt appears as the
/// picker opens rather than on the first take.
final class InputMonitor {
    /// `(uid, levels, access)`: one 0–1 level per input (the meter's dB
    /// scale), and `granted`, `denied` or `undetermined`.
    var onLevels: ((String, [Double], String) -> Void)?
    /// `(uid, channel, hz, clarity)`: the tuner's pitch on the channel the
    /// last ask named (ADR-539), 15 times a second; `hz` 0 for none.
    var onPitch: ((String, String, Double, Double) -> Void)?

    private var uid = ""
    private var deviceID: AudioDeviceID = 0
    private var procID: AudioDeviceIOProcID?
    private var timer: Timer?
    private var lastAsk = Date.distantPast
    /// Each input's loudest sample since the last report, from the IO thread.
    private var peaks: OSAllocatedUnfairLock<[Float]>?
    private var scratch: UnsafeMutablePointer<Float>?
    private var asking = false

    /// The tuner's channel (`"1/2"`, `"5"`, or `""` for none) and its
    /// recent samples, a pair summed to one. The IO thread writes the ring;
    /// a tick copies it out for the detector on `pitchQueue`.
    private struct Tune {
        var channels: [Int] = []
        var ring: [Float] = []
        var write = 0
        var filled = 0
    }
    private var tuneChannel = ""
    private var tune: OSAllocatedUnfairLock<Tune>?
    private var mono: UnsafeMutablePointer<Float>?
    private static let monoCapacity = 16384
    private var rate: Double = 48000
    private let pitchQueue = DispatchQueue(label: "vamp.tuner", qos: .userInitiated)
    private var detecting = false

    /// No ask for this long and the device is closed.
    private static let idleAfter: TimeInterval = 5

    /// The page's ask: meter `uid`, or stop for `''`; and tune `channel` on
    /// it, or nothing for `''`.
    func keep(uid next: String, tune channel: String = "") {
        lastAsk = Date()
        if next.isEmpty { close(); return }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            if next != uid || procID == nil { open(next) }
            setTune(channel)
        case .notDetermined:
            report(next, [], "undetermined")
            guard !asking else { return }
            asking = true
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async {
                    self.asking = false
                    if granted { self.open(next); self.setTune(channel) } else { self.report(next, [], "denied") }
                }
            }
        default:
            report(next, [], "denied")
        }
    }

    private func open(_ next: String) {
        close()
        guard let id = InputDevices.id(forUID: next) else { return }
        let streams = InputDevices.inputStreamChannels(id)
        let total = streams.reduce(0, +)
        guard total > 0 else { return }
        let lock = OSAllocatedUnfairLock(initialState: [Float](repeating: 0, count: total))
        let local = UnsafeMutablePointer<Float>.allocate(capacity: total)
        let deviceRate = max(8000, InputDevices.sampleRate(id))
        // The detector's window: 64 ms, room for two periods of 40 Hz.
        let tuneLock = OSAllocatedUnfairLock(initialState: Tune(ring: [Float](repeating: 0, count: Int(deviceRate * 0.064))))
        let monoBuf = UnsafeMutablePointer<Float>.allocate(capacity: Self.monoCapacity)
        let monoCap = Self.monoCapacity
        var proc: AudioDeviceIOProcID?
        let status = AudioDeviceCreateIOProcIDWithBlock(&proc, id, nil) { _, input, _, _, _ in
            let list = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
            // Which inputs the tuner sums; read without blocking the IO thread.
            let want = tuneLock.withLockIfAvailable { $0.channels } ?? []
            var monoFrames = 0
            var ch = 0
            for buf in list {
                let n = Int(buf.mNumberChannels)
                guard n > 0, let data = buf.mData?.assumingMemoryBound(to: Float32.self) else { ch += n; continue }
                let frames = Int(buf.mDataByteSize) / (MemoryLayout<Float32>.size * n)
                for c in 0..<n where ch + c < total {
                    var loudest: Float = 0
                    var f = 0
                    while f < frames { loudest = max(loudest, abs(data[f * n + c])); f += 1 }
                    local[ch + c] = loudest
                    if want.contains(ch + c) {
                        let m = min(frames, monoCap)
                        if monoFrames == 0 {
                            for i in 0..<m { monoBuf[i] = 0 }
                            monoFrames = m
                        }
                        let scale = 1 / Float(want.count)
                        for i in 0..<min(m, monoFrames) { monoBuf[i] += data[i * n + c] * scale }
                    }
                }
                ch += n
            }
            lock.withLock { p in
                for i in 0..<min(total, p.count) where local[i] > p[i] { p[i] = local[i] }
            }
            if monoFrames > 0 {
                _ = tuneLock.withLockIfAvailable { t in
                    let size = t.ring.count
                    guard size > 0 else { return }
                    for i in 0..<monoFrames {
                        t.ring[t.write] = monoBuf[i]
                        t.write = (t.write + 1) % size
                    }
                    t.filled = min(size, t.filled + monoFrames)
                }
            }
        }
        guard status == noErr, let proc else { local.deallocate(); monoBuf.deallocate(); return }
        guard AudioDeviceStart(id, proc) == noErr else {
            AudioDeviceDestroyIOProcID(id, proc)
            local.deallocate()
            monoBuf.deallocate()
            return
        }
        tune = tuneLock
        mono = monoBuf
        rate = deviceRate
        tuneChannel = ""
        uid = next
        deviceID = id
        procID = proc
        peaks = lock
        scratch = local
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 15, repeats: true) { [weak self] _ in
            self?.tick()
        }
    }

    private func tick() {
        if Date().timeIntervalSince(lastAsk) > Self.idleAfter { close(); return }
        guard let peaks else { return }
        let now = peaks.withLock { p -> [Float] in
            let v = p
            for i in p.indices { p[i] = 0 }
            return v
        }
        report(uid, now.map { InputRecorder.meterLevel(peak: $0) }, "granted")
        detectPitch()
    }

    /// Follow the ask's tuner channel; a new one starts from an empty ring.
    private func setTune(_ channel: String) {
        guard let tune, channel != tuneChannel else { return }
        tuneChannel = channel
        let channels = channel.isEmpty ? [] : (InputChannels.parse(channel, inputs: peaks?.withLock { $0.count } ?? 0) ?? [])
        tune.withLock { t in
            t.channels = channels
            t.filled = 0
            t.write = 0
        }
    }

    /// One detection per tick, never two at once: a slow one skips a tick.
    private func detectPitch() {
        guard let tune, !tuneChannel.isEmpty, !detecting else { return }
        let window: [Float]? = tune.withLock { t in
            guard !t.channels.isEmpty, t.filled == t.ring.count else { return nil }
            return Array(t.ring[t.write...] + t.ring[..<t.write])
        }
        let uid = self.uid, channel = tuneChannel, rate = self.rate
        guard let window else {
            onPitch?(uid, channel, 0, 0)
            return
        }
        detecting = true
        pitchQueue.async {
            let found = PitchDetector.detect(window, rate: rate)
            DispatchQueue.main.async {
                self.detecting = false
                guard self.uid == uid, self.tuneChannel == channel else { return }
                self.onPitch?(uid, channel, found?.hz ?? 0, found?.clarity ?? 0)
            }
        }
    }

    private func report(_ uid: String, _ levels: [Double], _ access: String) {
        onLevels?(uid, levels, access)
    }

    func close() {
        timer?.invalidate()
        timer = nil
        if let proc = procID {
            AudioDeviceStop(deviceID, proc)
            AudioDeviceDestroyIOProcID(deviceID, proc)
        }
        procID = nil
        peaks = nil
        // The IOProc is destroyed, so nothing writes here any more.
        scratch?.deallocate()
        scratch = nil
        mono?.deallocate()
        mono = nil
        tune = nil
        tuneChannel = ""
        uid = ""
    }
}
