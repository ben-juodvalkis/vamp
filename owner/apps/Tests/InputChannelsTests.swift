import XCTest

/// Settings → Capture's channel names, as the app's input recorder reads
/// them (ADR-533): a pair of neighbours or one input, inside the device.
final class InputChannelsTests: XCTestCase {
    func testAStereoPairIsTwoNeighbouringChannels() {
        XCTAssertEqual(InputChannels.parse("1/2", inputs: 14), [0, 1])
        XCTAssertEqual(InputChannels.parse("3/4", inputs: 14), [2, 3])
    }

    func testAMonoInputIsOneChannel() {
        XCTAssertEqual(InputChannels.parse("5", inputs: 14), [4])
    }

    func testAChannelTheDeviceLacksIsRefused() {
        XCTAssertNil(InputChannels.parse("3/4", inputs: 2))
        XCTAssertNil(InputChannels.parse("3", inputs: 2))
        XCTAssertNil(InputChannels.parse("0", inputs: 2))
    }

    func testAnythingElseIsRefused() {
        XCTAssertNil(InputChannels.parse("1/3", inputs: 8))
        XCTAssertNil(InputChannels.parse("", inputs: 8))
        XCTAssertNil(InputChannels.parse("L/R", inputs: 8))
    }

    func testTheDeviceListIsTheJSONTheBridgeReads() throws {
        let json = InputDevices.json([InputDevice(uid: "u1", name: "Babyface Pro", inputs: 14)])
        let list = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: Any]])
        XCTAssertEqual(list.first?["uid"] as? String, "u1")
        XCTAssertEqual(list.first?["inputs"] as? Int, 14)
    }
}

/// The app's meter reads as Vamp-Capture's: 0–1 for −70 dB to 0 dB.
final class InputMeterTests: XCTestCase {
    func testTheMeterIsDecibelsLikeTheDevice() {
        XCTAssertEqual(InputRecorder.meterLevel(peak: 1), 1, accuracy: 1e-9)
        XCTAssertEqual(InputRecorder.meterLevel(peak: 0), 0)
        XCTAssertEqual(InputRecorder.meterLevel(peak: 0.0001), 0, accuracy: 1e-9) // −80 dB
        XCTAssertEqual(InputRecorder.meterLevel(peak: 0.0177828), 0.5, accuracy: 1e-3) // −35 dB
        XCTAssertEqual(InputRecorder.meterLevel(peak: 2), 1)
    }
}

/// The tuner's detector (ADR-539) finds a string's pitch, and nothing in
/// silence.
final class PitchDetectorTests: XCTestCase {
    private func tone(_ hz: Double, rate: Double = 48000, harmonics: Bool = false) -> [Float] {
        (0..<Int(rate * 0.064)).map { i in
            let t = Double(i) / rate
            var v = sin(2 * .pi * hz * t)
            if harmonics { v += 0.5 * sin(4 * .pi * hz * t) + 0.3 * sin(6 * .pi * hz * t) }
            return Float(0.3 * v)
        }
    }

    func testItFindsTheStandardStrings() throws {
        for hz in [82.41, 110.0, 146.83, 196.0, 246.94, 329.63] {
            let found = try XCTUnwrap(PitchDetector.detect(tone(hz, harmonics: true), rate: 48000))
            // Within a cent: 2^(1/1200).
            XCTAssertEqual(found.hz / hz, 1, accuracy: 0.0006, "\(hz) Hz read as \(found.hz)")
            XCTAssertGreaterThan(found.clarity, 0.8)
        }
    }

    func testItReadsAt96kToo() throws {
        let found = try XCTUnwrap(PitchDetector.detect(tone(440, rate: 96000), rate: 96000))
        XCTAssertEqual(found.hz, 440, accuracy: 0.3)
    }

    func testSilenceAndNoiseHaveNoPitch() {
        XCTAssertNil(PitchDetector.detect([Float](repeating: 0, count: 3072), rate: 48000))
        var seed: UInt64 = 1
        let noise: [Float] = (0..<3072).map { _ in
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return Float(Int64(bitPattern: seed >> 11) % 1000) / 2000
        }
        XCTAssertNil(PitchDetector.detect(noise, rate: 48000))
    }
}
