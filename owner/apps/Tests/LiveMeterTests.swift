import XCTest

/// ADR-541: what Live draws in a device's panel, read back from a picture of
/// the device and a margin around it: the Glue's needle, the Auto Filter's
/// spectrum and the Compressor's activity view (ADR-543).
final class LiveMeterTests: XCTestCase {
    private let glue: NeedleShape = {
        guard case .needle(let s) = LiveMeter.kinds["GlueCompressor"]! else { fatalError() }
        return s
    }()
    private let autoFilter: SpectrumShape = {
        guard case .spectrum(let s) = LiveMeter.kinds["AutoFilter2"]! else { fatalError() }
        return s
    }()

    /// A device face (light grey, or `face`) with the dark panel (`ground`)
    /// and a needle at `db`, in a picture `margin` points larger each side
    /// (Live's window around the device, `outside`), the device `shift`
    /// points lower than expected (the window-origin offset).
    private func picture(db: Double, scale: Double, margin: CGSize = CGSize(width: 12, height: 40),
                         shift: Double = 0, face: UInt8 = 175, ground: UInt8 = 40,
                         outside: UInt8? = nil) -> (pixels: [UInt8], width: Int, height: Int) {
        let width = Int((304 + 2 * margin.width) * scale), height = Int((190 + 2 * margin.height) * scale)
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let ox = margin.width * scale, oy = (margin.height + shift) * scale
        func put(_ x: Int, _ y: Int, _ b: UInt8, _ g: UInt8, _ r: UInt8) {
            guard x >= 0, x < width, y >= 0, y < height else { return }
            let i = (y * width + x) * 4
            pixels[i] = b; pixels[i + 1] = g; pixels[i + 2] = r; pixels[i + 3] = 255
        }
        let around = outside ?? face
        for y in 0..<height { for x in 0..<width { put(x, y, around, around, around) } }
        for y in Int(oy)..<Int(oy + 190 * scale) { for x in Int(ox)..<Int(ox + 304 * scale) { put(x, y, face, face, face) } }
        // A narrow dark level meter at the device's left edge, as Live draws one.
        for y in Int(oy + 40 * scale)..<Int(oy + 180 * scale) {
            for x in Int(ox)..<Int(ox + 6 * scale) { put(x, y, 30, 30, 30) }
        }
        let panel = glue.panel
        for y in Int(oy + panel.minY * scale)..<Int(oy + panel.maxY * scale) {
            for x in Int(ox + panel.minX * scale)..<Int(ox + panel.maxX * scale) { put(x, y, ground, ground, ground) }
        }
        // The scale's labels along the panel's top: light glyphs whose
        // anti-aliased edges pass through every grey, the face's included.
        for y in Int(oy + (panel.minY + 3) * scale)..<Int(oy + (panel.minY + 9) * scale) {
            for x in stride(from: Int(ox + (panel.minX + 10) * scale), to: Int(ox + (panel.maxX - 10) * scale), by: Int(25 * scale)) {
                put(x, y, 134, 134, 134); put(x + 1, y, face, face, face)
            }
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
            LiveMeter.reading(pixels: $0.baseAddress!, width: p.width, height: p.height,
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

    /// Live's dark themes (Follow System's at night): the face is a dark
    /// grey itself (#363636), only a little lighter than the panel (#181818),
    /// and the window around the device another (#3e3e3e).
    func testReadsTheNeedleInADarkTheme() {
        for scale in [1.0, 2.0] {
            for db in [0.0, 8.3, 17.49] {
                let got = read(picture(db: db, scale: scale, face: 0x36, ground: 0x18, outside: 0x3e), scale: scale)
                XCTAssertEqual(got ?? -99, db, accuracy: scale == 1 ? 0.35 : 0.2, "scale \(scale) dB \(db)")
            }
        }
    }

    func testNoPanelOrNoNeedleIsNoReading() {
        let width = 328, height = 270
        let face = [UInt8](repeating: 175, count: width * height * 4)
        XCTAssertNil(face.withUnsafeBufferPointer {
            LiveMeter.reading(pixels: $0.baseAddress!, width: width, height: height,
                                   bytesPerRow: width * 4, scale: 1, shape: glue)
        })
        var bare = picture(db: 0, scale: 1)
        for i in stride(from: 0, to: bare.pixels.count, by: 4) where LiveMeter.isNeedle(b: bare.pixels[i], g: bare.pixels[i + 1], r: bare.pixels[i + 2]) {
            bare.pixels[i] = 40; bare.pixels[i + 1] = 40; bare.pixels[i + 2] = 40
        }
        XCTAssertNil(read(bare, scale: 1))
    }

    // MARK: - Spectrum

    /// The Auto Filter's display (dark ground, grid lines, Live's floor strip)
    /// with a fill whose top follows `levelAt(hz)` in dB and a flat cyan curve
    /// across it, inside a light device face with a margin, at `scale`.
    private func spectrumPicture(scale: Double, levelAt: (Double) -> Double) -> (pixels: [UInt8], width: Int, height: Int) {
        let s = autoFilter
        let margin = 20.0, face = 175 as UInt8
        let width = Int((s.panel.width + 2 * margin) * scale), height = Int((s.panel.height + 2 * margin) * scale)
        var pixels = [UInt8](repeating: face, count: width * height * 4)
        func put(_ x: Int, _ y: Int, _ v: (UInt8, UInt8, UInt8)) {
            guard x >= 0, x < width, y >= 0, y < height else { return }
            let i = (y * width + x) * 4
            pixels[i] = v.0; pixels[i + 1] = v.1; pixels[i + 2] = v.2; pixels[i + 3] = 255
        }
        let ox = Int(margin * scale), oy = Int(margin * scale)
        let w = Int(s.panel.width * scale), h = Int(s.panel.height * scale)
        for y in 0..<h { for x in 0..<w { put(ox + x, oy + y, (33, 33, 33)) } }
        for hz in [100.0, 1000, 10000] {
            let x = Int(log10(hz / s.hzAtLeft) * s.pointsPerDecade * scale)
            for y in 0..<h { put(ox + x, oy + y, (60, 60, 60)) }
        }
        for x in 0..<w {
            let hz = s.hzAtLeft * pow(10, Double(x) / scale / s.pointsPerDecade)
            let top = min(h, max(0, Int(((s.dbAtTop - levelAt(hz)) * s.pointsPerDb * scale).rounded())))
            for y in top..<h { put(ox + x, oy + y, (79, 79, 79)) }
            for y in Int(s.height * scale)..<h { put(ox + x, oy + y, (81, 81, 81)) }
            put(ox + x, oy + Int(40 * scale), (255, 230, 60))   // the cyan curve, B G R
        }
        return (pixels, width, height)
    }

    private func bands(_ p: (pixels: [UInt8], width: Int, height: Int), scale: Double) -> [Double]? {
        p.pixels.withUnsafeBufferPointer {
            LiveMeter.spectrum(pixels: $0.baseAddress!, width: p.width, height: p.height,
                               bytesPerRow: p.width * 4, scale: scale, shape: autoFilter)
        }
    }

    func testReadsASpectrumOntoTheStandardGrid() {
        for scale in [1.0, 2.0] {
            // A tone at 1 kHz, −12 dB, over a floor at −60.
            let p = spectrumPicture(scale: scale) { hz in abs(log10(hz / 1000)) < 0.02 ? -12 : -60 }
            guard let got = bands(p, scale: scale) else { return XCTFail("no display at scale \(scale)") }
            XCTAssertEqual(got.count, LiveMeter.bandCount)
            let peak = got.indices.max { got[$0] < got[$1] }!
            let edges = LiveMeter.bandEdges(peak)
            XCTAssertTrue(edges.low <= 1000 && 1000 <= edges.high * 1.05, "peak band \(edges) at scale \(scale)")
            XCTAssertEqual(got[peak], -12, accuracy: 1.2, "scale \(scale)")
            XCTAssertEqual(got[5], -60, accuracy: 1.2, "a quiet band reads the fill, not the grid or the curve")
        }
    }

    func testASilentSpectrumReadsTheFloor() {
        let p = spectrumPicture(scale: 1) { _ in -200 }
        let got = bands(p, scale: 1)
        XCTAssertNotNil(got)
        XCTAssertTrue(got!.allSatisfy { $0 == autoFilter.floorDb }, "\(got!)")
    }

    func testTheBandsCoverTwentyHertzToTwentyKilohertz() {
        XCTAssertEqual(LiveMeter.bandEdges(0).low, 20, accuracy: 0.001)
        XCTAssertEqual(LiveMeter.bandEdges(LiveMeter.bandCount - 1).high, 20000, accuracy: 0.01)
        XCTAssertEqual(LiveMeter.bandEdges(10).high, LiveMeter.bandEdges(11).low, accuracy: 1e-9)
    }
    // MARK: - Activity (ADR-543)

    private let compressor: ActivityShape = {
        guard case .activity(let s) = LiveMeter.kinds["Compressor2"]! else { fatalError() }
        return s
    }()

    /// The Compressor's display as Live 13 draws it in a dark theme, at 1x:
    /// a 61 frame, the 23 ground, rules at 54 around a 128 pt graph, the
    /// signal's fill (73) rising `fillAt(x)` of the graph, the orange line at
    /// `lineAt(x)`, the zero line's dots and the cyan threshold.
    private func activityPicture(fillAt: (Double) -> Double, lineAt: (Double) -> Double, threshold: Double,
                                 readout: Bool = false) -> (pixels: [UInt8], width: Int, height: Int) {
        let width = 310, height = 240
        var px = [UInt8](repeating: 47, count: width * height * 4)
        func put(_ x: Int, _ y: Int, _ v: (UInt8, UInt8, UInt8)) {
            let i = (y * width + x) * 4
            px[i] = v.2; px[i + 1] = v.1; px[i + 2] = v.0; px[i + 3] = 255
        }
        for y in 40..<215 { for x in 20..<286 { put(x, y, (61, 61, 61)) } }
        for y in 44..<213 { for x in 22..<284 { put(x, y, (23, 23, 23)) } }
        let top = 63, floorRow = 192
        for x in 22..<284 { put(x, top, (54, 54, 54)); put(x, floorRow + 1, (54, 54, 54)) }
        func row(_ h: Double) -> Int { floorRow - Int((h * Double(floorRow - top - 1)).rounded()) }
        for x in 22..<284 {
            let t = Double(x - 22) / 261
            if x % 2 == 0 { put(x, row(0.85), (62, 62, 62)) }
            let f = fillAt(t)
            if f > 0 { for y in row(f)...floorRow { put(x, y, (73, 73, 73)) } }
            put(x, row(threshold), (0, 186, 206))
            put(x, row(lineAt(t)), (243, 152, 75))
        }
        // Live's reduction number ("-4.07 dB"), in the line's orange at the foot.
        if readout { for y in 170..<180 { for x in 230..<275 where (x + y) % 3 == 0 { put(x, y, (243, 152, 75)) } } }
        return (px, width, height)
    }

    func testReadsTheActivityViewAsHeights() {
        let p = activityPicture(fillAt: { $0 < 0.5 ? 0.47 : 0.1 }, lineAt: { $0 < 0.5 ? 0.75 : 0.85 }, threshold: 0.297)
        let v = p.pixels.withUnsafeBufferPointer {
            LiveMeter.activity(pixels: $0.baseAddress!, width: p.width, height: p.height, bytesPerRow: p.width * 4,
                               scale: 1, shape: compressor)
        }
        guard let v else { return XCTFail("no reading") }
        let n = compressor.columns
        XCTAssertEqual(v.count, 1 + 2 * n)
        XCTAssertEqual(v[0], 0.297, accuracy: 0.01)
        XCTAssertEqual(v[1 + 10], 0.47, accuracy: 0.01)
        XCTAssertEqual(v[1 + n - 10], 0.1, accuracy: 0.01)
        XCTAssertEqual(v[1 + n + 10], 0.75, accuracy: 0.01)
        XCTAssertEqual(v[1 + n + n - 10], 0.85, accuracy: 0.01)
    }

    func testASilentActivityViewIsAnEmptyFill() {
        let p = activityPicture(fillAt: { _ in 0 }, lineAt: { _ in 0.85 }, threshold: 0.6)
        let v = p.pixels.withUnsafeBufferPointer {
            LiveMeter.activity(pixels: $0.baseAddress!, width: p.width, height: p.height, bytesPerRow: p.width * 4,
                               scale: 1, shape: compressor)
        }
        guard let v else { return XCTFail("no reading") }
        XCTAssertEqual(v[0], 0.6, accuracy: 0.01)
        XCTAssertEqual(Array(v[1...compressor.columns]), Array(repeating: 0, count: compressor.columns))
    }

    func testTheReductionNumberIsNotTheLine() {
        // Where Live drew no line in a column, its number below is not read as one.
        let p = activityPicture(fillAt: { _ in 0.2 }, lineAt: { _ in 0.85 }, threshold: 0.3, readout: true)
        var pixels = p.pixels
        for y in 0..<p.height { for x in 240..<246 {
            let i = (y * p.width + x) * 4
            if pixels[i + 2] == 243 && y < 120 { pixels[i] = 23; pixels[i + 1] = 23; pixels[i + 2] = 23 }
        } }
        let v = pixels.withUnsafeBufferPointer {
            LiveMeter.activity(pixels: $0.baseAddress!, width: p.width, height: p.height, bytesPerRow: p.width * 4,
                               scale: 1, shape: compressor)
        }
        guard let v else { return XCTFail("no reading") }
        let line = v[(1 + compressor.columns)...]
        XCTAssertTrue(line.allSatisfy { $0 < 0 || $0 > 0.8 }, "a line reading off the number: \(line.filter { $0 >= 0 && $0 <= 0.8 })")
    }
}
