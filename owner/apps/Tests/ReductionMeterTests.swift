import XCTest

/// ADR-541: the needle Live draws, read back as dB, from a picture of the
/// device and a margin around it.
final class ReductionMeterTests: XCTestCase {
    private let glue = ReductionMeter.shapes["GlueCompressor"]!

    /// A device face (light grey) with the dark panel and a needle at `db`,
    /// in a picture `margin` points larger each side, the device `shift`
    /// points lower than expected (the window-origin offset).
    private func picture(db: Double, scale: Double, margin: CGSize = CGSize(width: 12, height: 40),
                         shift: Double = 0) -> (pixels: [UInt8], width: Int, height: Int) {
        let width = Int((304 + 2 * margin.width) * scale), height = Int((190 + 2 * margin.height) * scale)
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let ox = margin.width * scale, oy = (margin.height + shift) * scale
        func put(_ x: Int, _ y: Int, _ b: UInt8, _ g: UInt8, _ r: UInt8) {
            guard x >= 0, x < width, y >= 0, y < height else { return }
            let i = (y * width + x) * 4
            pixels[i] = b; pixels[i + 1] = g; pixels[i + 2] = r; pixels[i + 3] = 255
        }
        for y in 0..<height { for x in 0..<width { put(x, y, 175, 175, 175) } }
        // A narrow dark level meter at the device's left edge, as Live draws one.
        for y in Int(oy + 40 * scale)..<Int(oy + 180 * scale) {
            for x in Int(ox)..<Int(ox + 6 * scale) { put(x, y, 30, 30, 30) }
        }
        let panel = glue.panel
        for y in Int(oy + panel.minY * scale)..<Int(oy + panel.maxY * scale) {
            for x in Int(ox + panel.minX * scale)..<Int(ox + panel.maxX * scale) { put(x, y, 40, 40, 40) }
        }
        let radians = (db - glue.dbAtUp) / glue.dbPerDegree * .pi / 180
        let px = ox + glue.pivot.x * scale, py = oy + glue.pivot.y * scale
        for step in 0..<Int(140 * scale) {
            let d = Double(step)
            let x = Int((px + d * sin(radians)).rounded()), y = Int((py - d * cos(radians)).rounded())
            // Only inside the panel, as Live clips it.
            guard Double(y) >= oy + panel.minY * scale, Double(y) < oy + panel.maxY * scale else { continue }
            put(x, y, 255, 240, 90)
            put(x + 1, y, 200, 190, 80)
        }
        return (pixels, width, height)
    }

    private func read(_ p: (pixels: [UInt8], width: Int, height: Int), scale: Double) -> Double? {
        p.pixels.withUnsafeBufferPointer {
            ReductionMeter.reading(pixels: $0.baseAddress!, width: p.width, height: p.height,
                                   bytesPerRow: p.width * 4, scale: scale, shape: glue)
        }
    }

    func testReadsTheNeedleAcrossTheScale() {
        for scale in [1.0, 2.0] {
            for db in [0.0, 4.0, 8.3, 12.79, 17.49, 20.0] {
                let got = read(picture(db: db, scale: scale), scale: scale)
                XCTAssertNotNil(got, "scale \(scale) dB \(db)")
                XCTAssertEqual(got ?? -99, db, accuracy: scale == 1 ? 0.35 : 0.2, "scale \(scale)")
            }
        }
    }

    func testFindsThePanelWhereverTheDeviceLands() {
        for shift in [-33.0, 0, 33] {
            let got = read(picture(db: 12.79, scale: 1, shift: shift), scale: 1)
            XCTAssertEqual(got ?? -99, 12.79, accuracy: 0.35, "shift \(shift)")
        }
    }

    func testNoPanelOrNoNeedleIsNoReading() {
        let width = 328, height = 270
        let face = [UInt8](repeating: 175, count: width * height * 4)
        XCTAssertNil(face.withUnsafeBufferPointer {
            ReductionMeter.reading(pixels: $0.baseAddress!, width: width, height: height,
                                   bytesPerRow: width * 4, scale: 1, shape: glue)
        })
        var bare = picture(db: 0, scale: 1)
        for i in stride(from: 0, to: bare.pixels.count, by: 4) where ReductionMeter.isNeedle(b: bare.pixels[i], g: bare.pixels[i + 1], r: bare.pixels[i + 2]) {
            bare.pixels[i] = 40; bare.pixels[i + 1] = 40; bare.pixels[i + 2] = 40
        }
        XCTAssertNil(read(bare, scale: 1))
    }
}
