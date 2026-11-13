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
