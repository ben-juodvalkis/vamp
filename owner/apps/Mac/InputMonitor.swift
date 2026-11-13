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

    private var uid = ""
    private var deviceID: AudioDeviceID = 0
    private var procID: AudioDeviceIOProcID?
    private var timer: Timer?
    private var lastAsk = Date.distantPast
    /// Each input's loudest sample since the last report, from the IO thread.
    private var peaks: OSAllocatedUnfairLock<[Float]>?
    private var scratch: UnsafeMutablePointer<Float>?
    private var asking = false

    /// No ask for this long and the device is closed.
    private static let idleAfter: TimeInterval = 5

    /// The page's ask: meter `uid`, or stop for `''`.
    func keep(uid next: String) {
        lastAsk = Date()
        if next.isEmpty { close(); return }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            if next != uid || procID == nil { open(next) }
        case .notDetermined:
            report(next, [], "undetermined")
            guard !asking else { return }
            asking = true
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async {
                    self.asking = false
                    if granted { self.open(next) } else { self.report(next, [], "denied") }
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
        var proc: AudioDeviceIOProcID?
        let status = AudioDeviceCreateIOProcIDWithBlock(&proc, id, nil) { _, input, _, _, _ in
            let list = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
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
                }
                ch += n
            }
            lock.withLock { p in
                for i in 0..<min(total, p.count) where local[i] > p[i] { p[i] = local[i] }
            }
        }
        guard status == noErr, let proc else { local.deallocate(); return }
        guard AudioDeviceStart(id, proc) == noErr else {
            AudioDeviceDestroyIOProcID(id, proc)
            local.deallocate()
            return
        }
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
        uid = ""
    }
}
