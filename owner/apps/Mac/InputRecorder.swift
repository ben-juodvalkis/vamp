import AVFoundation
import AudioToolbox
import CoreAudio
import Foundation
import os

/// One Core Audio device with inputs, as Settings → Capture offers it.
struct InputDevice: Equatable {
    /// Core Audio's UID: stable across launches and replugging, unlike its id.
    let uid: String
    let name: String
    /// How many input channels it has, across all its input streams.
    let inputs: Int
}

/// The Mac's input devices, read from Core Audio each time they are asked for.
enum InputDevices {
    static func all() -> [InputDevice] {
        deviceIDs().compactMap { id in
            let inputs = inputChannelCount(id)
            guard inputs > 0, let uid = string(id, kAudioDevicePropertyDeviceUID),
                  let name = string(id, kAudioObjectPropertyName) else { return nil }
            return InputDevice(uid: uid, name: name, inputs: inputs)
        }
    }

    static func id(forUID uid: String) -> AudioDeviceID? {
        deviceIDs().first { string($0, kAudioDevicePropertyDeviceUID) == uid }
    }

    /// The JSON the bridge takes in `/capture/input/hello`.
    static func json(_ devices: [InputDevice]) -> String {
        let list = devices.map { ["uid": $0.uid, "name": $0.name, "inputs": $0.inputs] as [String: Any] }
        guard let data = try? JSONSerialization.data(withJSONObject: list) else { return "[]" }
        return String(data: data, encoding: .utf8) ?? "[]"
    }

    static func deviceIDs() -> [AudioDeviceID] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr
        else { return [] }
        var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids) == noErr
        else { return [] }
        return ids
    }

    /// The channel count of each input stream, in order (the IOProc's buffers).
    static func inputStreamChannels(_ id: AudioDeviceID) -> [Int] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: kAudioDevicePropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(id, &address, 0, nil, &size) == noErr, size > 0 else { return [] }
        let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { raw.deallocate() }
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, raw) == noErr else { return [] }
        let list = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
        return list.map { Int($0.mNumberChannels) }
    }

    static func inputChannelCount(_ id: AudioDeviceID) -> Int {
        inputStreamChannels(id).reduce(0, +)
    }

    static func sampleRate(_ id: AudioDeviceID) -> Double {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyNominalSampleRate,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var rate: Float64 = 0
        var size = UInt32(MemoryLayout<Float64>.size)
        return AudioObjectGetPropertyData(id, &address, 0, nil, &size, &rate) == noErr ? rate : 0
    }

    private static func string(_ id: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, &value) == noErr,
              let s = value?.takeRetainedValue() else { return nil }
        return s as String
    }
}

/// The channel names Settings sends, read into zero-based channel indices:
/// "3/4" is the stereo pair 3 and 4, "5" is mono input 5, as Live names them.
enum InputChannels {
    static func parse(_ name: String, inputs: Int) -> [Int]? {
        let parts = name.split(separator: "/").map { Int($0.trimmingCharacters(in: .whitespaces)) }
        guard (1...2).contains(parts.count), parts.allSatisfy({ $0 != nil }) else { return nil }
        let channels = parts.map { $0! - 1 }
        guard channels.allSatisfy({ $0 >= 0 && $0 < inputs }) else { return nil }
        if channels.count == 2 && channels[1] != channels[0] + 1 { return nil }
        return channels
    }
}

/// Records one input device's chosen channel or pair into a 24-bit WAV
/// (ADR-533). The device is opened on its own, beside Live, which keeps its
/// own hold on the same interface: Core Audio lets both read it.
///
/// The audio arrives on the device's IO thread; the file is written with
/// `ExtAudioFileWriteAsync`, made for that thread. Everything else runs on
/// the main thread, where `onReply` is called.
final class InputRecorder {
    /// `/capture/input/{state,meter,file,error}` for the bridge.
    var onReply: ((String, [OSCArg]) -> Void)?
    private(set) var recording = false

    private var deviceID: AudioDeviceID = 0
    private var procID: AudioDeviceIOProcID?
    private var file: ExtAudioFileRef?
    private var filePath = ""
    private var meterTimer: Timer?
    /// The loudest sample since the meter last read it, written on the IO thread.
    private let peak = OSAllocatedUnfairLock(initialState: Float(0))
    /// The IO thread's interleaved copy of the chosen channels: made before
    /// the device starts, so the IO thread never allocates.
    private var scratch: UnsafeMutablePointer<Float32>?
    private static let maxFrames = 16_384

    private static let filePrefix = "LOOPING_CAPTURE_"

    func start(folder: String, uid: String, channel: String) {
        guard !recording else { return }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            begin(folder: folder, uid: uid, channel: channel)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async {
                    if granted { self.begin(folder: folder, uid: uid, channel: channel) }
                    else { self.refuse("mic-denied", "Vamp for Mac may not use the microphone") }
                }
            }
        default:
            refuse("mic-denied", "Vamp for Mac may not use the microphone")
        }
    }

    private func begin(folder: String, uid: String, channel: String) {
        guard !recording else { return }
        guard let id = InputDevices.id(forUID: uid) else {
            return refuse("no-input-device", "the input device is not connected")
        }
        let streams = InputDevices.inputStreamChannels(id)
        let inputs = streams.reduce(0, +)
        guard let channels = InputChannels.parse(channel, inputs: inputs) else {
            return refuse("no-input-channel", "the device has no input \(channel)")
        }
        let rate = InputDevices.sampleRate(id)
        guard rate > 0 else { return refuse("no-input-device", "the input device has no sample rate") }

        filePath = (folder as NSString).appendingPathComponent("\(Self.filePrefix)\(Self.timestamp(Date())).wav")
        let count = UInt32(channels.count)
        var fileFormat = AudioStreamBasicDescription(
            mSampleRate: rate, mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked,
            mBytesPerPacket: 3 * count, mFramesPerPacket: 1, mBytesPerFrame: 3 * count,
            mChannelsPerFrame: count, mBitsPerChannel: 24, mReserved: 0)
        var clientFormat = AudioStreamBasicDescription(
            mSampleRate: rate, mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
            mBytesPerPacket: 4 * count, mFramesPerPacket: 1, mBytesPerFrame: 4 * count,
            mChannelsPerFrame: count, mBitsPerChannel: 32, mReserved: 0)
        var made: ExtAudioFileRef?
        let url = URL(fileURLWithPath: filePath) as CFURL
        guard ExtAudioFileCreateWithURL(url, kAudioFileWAVEType, &fileFormat, nil,
                                        AudioFileFlags.eraseFile.rawValue, &made) == noErr, let made else {
            return refuse("file-failed", "could not create \(filePath)")
        }
        ExtAudioFileSetProperty(made, kExtAudioFileProperty_ClientDataFormat,
                                UInt32(MemoryLayout<AudioStreamBasicDescription>.size), &clientFormat)
        // Primes the async writer off the IO thread, as its docs ask.
        ExtAudioFileWriteAsync(made, 0, nil)
        file = made

        // Where each chosen channel sits: which input buffer, which slot in it.
        var where_: [(buffer: Int, offset: Int)] = []
        for ch in channels {
            var first = 0
            for (b, n) in streams.enumerated() {
                if ch < first + n { where_.append((b, ch - first)); break }
                first += n
            }
        }
        let buffer = UnsafeMutablePointer<Float32>.allocate(capacity: Self.maxFrames * channels.count)
        scratch = buffer
        let peak = self.peak
        let out = made
        let width = channels.count

        var proc: AudioDeviceIOProcID?
        let status = AudioDeviceCreateIOProcIDWithBlock(&proc, id, nil) { _, input, _, _, _ in
            let list = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
            var frames = Int.max
            for (b, _) in where_ {
                let buf = list[b]
                frames = min(frames, Int(buf.mDataByteSize) / (MemoryLayout<Float32>.size * Int(buf.mNumberChannels)))
            }
            guard frames != Int.max, frames > 0 else { return }
            frames = min(frames, InputRecorder.maxFrames)
            var loudest: Float32 = 0
            for (i, w) in where_.enumerated() {
                let buf = list[w.buffer]
                guard let data = buf.mData?.assumingMemoryBound(to: Float32.self) else { continue }
                let stride = Int(buf.mNumberChannels)
                for f in 0..<frames {
                    let v = data[f * stride + w.offset]
                    buffer[f * width + i] = v
                    loudest = max(loudest, abs(v))
                }
            }
            var abl = AudioBufferList(mNumberBuffers: 1, mBuffers: AudioBuffer(
                mNumberChannels: UInt32(width), mDataByteSize: UInt32(frames * width * 4), mData: buffer))
            ExtAudioFileWriteAsync(out, UInt32(frames), &abl)
            let heard = loudest
            peak.withLock { $0 = max($0, heard) }
        }
        guard status == noErr, let proc else {
            closeFile()
            return refuse("no-input-device", "could not open the input device (\(status))")
        }
        guard AudioDeviceStart(id, proc) == noErr else {
            AudioDeviceDestroyIOProcID(id, proc)
            closeFile()
            return refuse("no-input-device", "the input device would not start")
        }
        deviceID = id
        procID = proc
        recording = true
        onReply?("/capture/input/state", [.string("recording")])
        // Vamp-Capture's own meter, so REC reads the same either way
        // (wire-protocol §2.15): 0–1 for −70 dB to 0 dB, ~15 a second.
        meterTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 15, repeats: true) { [weak self] _ in
            guard let self else { return }
            let level = self.peak.withLock { p -> Float in let v = p; p = 0; return v }
            self.onReply?("/capture/input/meter", [.double(InputRecorder.meterLevel(peak: level))])
        }
    }

    func stop() {
        guard recording, let proc = procID else { return }
        AudioDeviceStop(deviceID, proc)
        AudioDeviceDestroyIOProcID(deviceID, proc)
        procID = nil
        recording = false
        meterTimer?.invalidate()
        meterTimer = nil
        onReply?("/capture/input/state", [.string("idle")])
        let path = filePath
        // Closing flushes what the async writer still holds: off the main thread.
        let toClose = file
        file = nil
        let buffer = scratch
        scratch = nil
        DispatchQueue.global(qos: .userInitiated).async {
            if let toClose { ExtAudioFileDispose(toClose) }
            buffer?.deallocate()
            DispatchQueue.main.async {
                self.onReply?("/capture/input/file", [.string(path)])
            }
        }
    }

    private func closeFile() {
        if let file { ExtAudioFileDispose(file) }
        file = nil
        scratch?.deallocate()
        scratch = nil
        try? FileManager.default.removeItem(atPath: filePath)
    }

    private func refuse(_ code: String, _ detail: String) {
        NSLog("[Vamp for Mac] capture refused: \(code): \(detail)")
        onReply?("/capture/input/error", [.string(code), .string(detail)])
        onReply?("/capture/input/state", [.string("idle")])
    }

    /// A linear peak as the meter's 0–1: −70 dB and below is 0, 0 dB is 1.
    static func meterLevel(peak: Float) -> Double {
        guard peak > 0 else { return 0 }
        let db = 20 * log10(Double(peak))
        return min(max((db + 70) / 70, 0), 1)
    }

    /// YYYYMMDD_HHMMSS, as Vamp-Capture names its files.
    private static func timestamp(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyyMMdd_HHmmss"
        return f.string(from: d)
    }
}
