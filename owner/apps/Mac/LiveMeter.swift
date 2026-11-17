import CoreGraphics
import Foundation

/// What Live draws in a device's panel that the LOM does not carry, read off
/// Live's window (ADR-541): a **needle** (the Glue's gain reduction), a
/// **spectrum** (the Auto Filter's) or an **activity** view (the
/// Compressor's, ADR-543). Each device class names its kind and
/// the measured geometry; the readers below are pure, so the tests can feed
/// them pictures. Adding a device is a measured entry in `kinds`.
enum LiveMeterKind: Equatable {
    case needle(NeedleShape)
    case spectrum(SpectrumShape)
    case activity(ActivityShape)

    /// The panel the kind draws in, in points; only its size is used to find
    /// it in a picture (`LiveMeter.locatePanel`).
    var panel: CGSize {
        switch self {
        case .needle(let s): return s.panel.size
        case .spectrum(let s): return s.panel
        case .activity(let s): return s.panel
        }
    }

    /// The wire name of what it reads: `reduction`, `spectrum` or `activity`.
    var name: String {
        switch self {
        case .needle: return "reduction"
        case .spectrum: return "spectrum"
        case .activity: return "activity"
        }
    }
}

/// A needle meter: the needle turns about a pivot on a linear dB scale.
struct NeedleShape: Equatable {
    /// The meter's dark panel, in points from the device's top-left corner,
    /// as `locatePanel` finds it (only the size and the pivot's place in it
    /// are used: ScreenCaptureKit's window coordinates and Accessibility's
    /// can differ by the window's origin, 33 pt in a full-height window).
    let panel: CGRect
    /// The needle's pivot, in points from the device's top-left corner.
    let pivot: CGPoint
    /// dB = `dbAtUp + dbPerDegree × angle`, the angle in degrees clockwise
    /// from straight up.
    let dbAtUp: Double
    let dbPerDegree: Double
    /// The scale's ends, in dB.
    let range: ClosedRange<Double>

    /// The pivot from the panel's top-left corner, in points.
    var pivotInPanel: CGPoint { CGPoint(x: pivot.x - panel.minX, y: pivot.y - panel.minY) }
}

/// A spectrum display: a grey fill whose top edge is the level, on a log
/// frequency axis across and a linear dB axis up.
struct SpectrumShape: Equatable {
    /// The display's size, in points (found in the picture by its dark ground).
    let panel: CGSize
    /// The frequency at the panel's left edge, and points per decade across.
    let hzAtLeft: Double
    let pointsPerDecade: Double
    /// dB = `dbAtTop − row / pointsPerDb`, the row in points from the panel's top.
    let dbAtTop: Double
    let pointsPerDb: Double
    /// Rows from the top that hold the spectrum (below is the device's own strip).
    let height: Double
    /// The quietest level drawn, in dB: an empty column reads this.
    let floorDb: Double
    /// The darkest grey that is fill: above the display's grid lines.
    var fillMin: UInt8 = 70
    /// Columns from the left edge, in points, where the display draws its dB
    /// labels: they read the first column right of them.
    var labelColumns: Double = 0
}

/// An activity view: the signal's level over time as a grey fill rising
/// from the floor, a line (the gain reduction, orange) and the threshold (a
/// cyan line across), scrolling right to left, between two rules across the
/// display. Read as heights, 0 at the floor and 1 at the top: Live's own
/// scale (+6 dB at the top, −∞ at the floor, not linear in dB), so a
/// drawing of them is Live's picture.
struct ActivityShape: Equatable {
    /// The display with its frame, in points (found by its dark ground).
    let panel: CGSize
    /// Columns sent, evenly across the display.
    var columns: Int = 128
}

enum LiveMeter {
    /// Measured on Live 13.0b25 at 100% zoom (2026-11-16).
    static let kinds: [String: LiveMeterKind] = [
        // Five needle positions on a steady tone meet at one pivot to 0.03 px;
        // the ticks (0 5 10 15 20) are 25.0° apart, 10 straight up.
        "GlueCompressor": .needle(NeedleShape(
            panel: CGRect(x: 93, y: 25, width: 139, height: 77),
            pivot: CGPoint(x: 162.75, y: 110.7),
            dbAtUp: 10, dbPerDegree: 0.2, range: 0...20)),
        // 1 kHz tones at −6, −18, −30 dBFS peak at x 167 pt (1012 Hz) and
        // 87 / 74 / 61 pt up a 95 pt display: 98 pt a decade from 20 Hz,
        // 13 pt per 12 dB, the top at +1.4 dB. Grid lines at 100 Hz, 1 kHz,
        // 10 kHz. Rows from 88 down are a strip Live always fills: the floor.
        "AutoFilter2": .spectrum(SpectrumShape(
            panel: CGSize(width: 296, height: 95),
            hzAtLeft: 20, pointsPerDecade: 98,
            dbAtTop: 1.4, pointsPerDb: 13.0 / 12.0, height: 87, floorDb: -79)),
        // 1 kHz tones at −6 … −36 dBFS, read live, peak at 998 Hz, 1 pt per dB
        // down from +9 dB at the top (± 3 dB: a pure tone's spike is a pixel or
        // two wide here). Ground 33, grid 60, fill 81 as Live delivers them (a
        // PNG decode lifts them, so measure live); dB labels fill the left
        // 22 pt, frequency labels the rows from 66 down, so the floor is −57 dB.
        "ChannelEq": .spectrum(SpectrumShape(
            panel: CGSize(width: 239, height: 81),
            hzAtLeft: 20, pointsPerDecade: 79.5,
            dbAtTop: 9, pointsPerDb: 1, height: 66, floorDb: -57,
            labelColumns: 22)),
        // The Compressor in its activity view, measured on Live 13.0b25 (ADR-543): the display between its
        // two rules is 262 × 128 pt; the threshold line sits at +6 dB at the
        // top, 0 dB 19 pt down, −6 at 39, −24 at 90, −41 at 110 and −∞ on the
        // floor (128): Live's scale, which the heights keep.
        "Compressor2": .activity(ActivityShape(panel: CGSize(width: 266, height: 173)))
    ]

    // MARK: - The standard spectrum grid

    /// Every spectrum goes on the wire on this grid, whatever its device
    /// draws: `bandCount` bands, log-spaced from `lowHz` to `highHz`.
    static let bandCount = 64
    static let lowHz = 20.0
    static let highHz = 20000.0

    /// Band `i`'s edges, in Hz.
    static func bandEdges(_ i: Int) -> (low: Double, high: Double) {
        let step = log10(highHz / lowHz) / Double(bandCount)
        return (lowHz * pow(10, step * Double(i)), lowHz * pow(10, step * Double(i + 1)))
    }

    // MARK: - Pixels

    /// Is this BGRA pixel a needle or a curve? Live draws its accent cyan
    /// while its window is active and near-white while it is not (measured:
    /// ≥ 190 in each channel, where ticks, labels and fills stay below).
    @inline(__always)
    static func isNeedle(b: UInt8, g: UInt8, r: UInt8) -> Bool {
        (Int(b) - Int(r) > 60 && Int(g) - Int(r) > 50 && b > 110) || (r >= 190 && g >= 190 && b >= 190)
    }

    /// The levels the device face may be in a picture (brightest channel),
    /// commonest first: the few that each cover a good share of its middle
    /// rows. The face is one flat colour and the one thing a panel is told
    /// apart by: Live's meter panels are dark in every theme
    /// (#0d0d0d–#29231f), but its face is light grey in the light themes
    /// (#a1–#b0) and dark grey in the dark ones (#2f–#3c), which `Follow
    /// System` switches to at sunset (measured 2026-11-16: a fixed "darker
    /// than 150" took the whole dark face for panel). The middle rows, since
    /// the picture's margin above and below is Live's window, not the device;
    /// several, since a display can cover more of a small device than its face.
    static func faceLevels(pixels: UnsafePointer<UInt8>, width: Int, height: Int, bytesPerRow: Int) -> [Int] {
        var counts = [Int](repeating: 0, count: 256), total = 0
        for y in stride(from: height * 3 / 10, to: height * 7 / 10, by: 2) {
            let row = pixels + y * bytesPerRow
            for x in stride(from: 0, to: width, by: 2) {
                counts[Int(max(row[x * 4], row[x * 4 + 1], row[x * 4 + 2]))] += 1
                total += 1
            }
        }
        return counts.indices.filter { counts[$0] * 20 >= total }.sorted { counts[$0] > counts[$1] }.prefix(3).map { $0 }
    }

    /// Part of a panel: anything not the device face (`face`, its level), so
    /// the panel's ground, the ticks, labels and fills on it, and a needle.
    @inline(__always)
    static func isPanel(b: UInt8, g: UInt8, r: UInt8, face: Int) -> Bool {
        abs(Int(max(r, g, b)) - face) > 3 || isNeedle(b: b, g: g, r: r)
    }

    /// A spectrum's fill: a neutral grey above the panel's ground (≈ 33) and
    /// its grid lines (≈ 60, 68 after a colour-space conversion), below the
    /// device face (measured fill ≈ 72–97).
    @inline(__always)
    static func isFill(b: UInt8, g: UInt8, r: UInt8, min fillMin: UInt8 = 70) -> Bool {
        let hi = max(r, g, b), lo = min(r, g, b)
        // Neutral: the curve's blended edge where it fades to grey (56, 70, 67) is not.
        return hi >= fillMin && hi <= 125 && hi - lo < 4
    }

    /// A panel's top-left corner in a BGRA picture taken at `scale` pixels per
    /// point, or nil when no panel-sized area is in it. Per row, the longest
    /// run that is not the device face; a panel row's is about the panel's
    /// width. The longest stack of such rows is the panel, and its runs'
    /// commonest start its left edge (a level meter beside it is dark, but
    /// narrow; Live's window around the device is wide).
    static func locatePanel(
        pixels: UnsafePointer<UInt8>, width: Int, height: Int, bytesPerRow: Int,
        scale: Double, panel: CGSize
    ) -> (x: Int, y: Int)? {
        for face in faceLevels(pixels: pixels, width: width, height: height, bytesPerRow: bytesPerRow) {
            if let at = locatePanel(pixels: pixels, width: width, height: height, bytesPerRow: bytesPerRow,
                                    scale: scale, panel: panel, face: face) { return at }
        }
        return nil
    }

    /// `locatePanel` against one face level.
    static func locatePanel(
        pixels: UnsafePointer<UInt8>, width: Int, height: Int, bytesPerRow: Int,
        scale: Double, panel: CGSize, face: Int
    ) -> (x: Int, y: Int)? {
        let panelWidth = Int(panel.width * scale)
        let need = panelWidth * 85 / 100
        // A label's anti-aliased edge can pass through the face's level, so a
        // run bridges that many face pixels; the face between a panel and its
        // neighbours is wider.
        let bridge = max(2, Int((2 * scale).rounded()))
        var best = (start: -1, length: 0), run = (start: -1, length: 0)
        var starts = [Int](repeating: -1, count: height)
        for y in 0..<height {
            let row = pixels + y * bytesPerRow
            var longest = (start: 0, length: 0), current = (start: -1, end: -1), faceRun = 0
            for x in 0..<width {
                if isPanel(b: row[x * 4], g: row[x * 4 + 1], r: row[x * 4 + 2], face: face) {
                    current = current.start < 0 ? (x, x) : (current.start, x)
                    faceRun = 0
                    if current.end - current.start + 1 > longest.length { longest = (current.start, current.end - current.start + 1) }
                } else if current.start >= 0 {
                    faceRun += 1
                    if faceRun > bridge { current = (-1, -1) }
                }
            }
            if longest.length >= need && longest.length <= panelWidth * 13 / 10 {
                starts[y] = longest.start
                run = run.start < 0 ? (y, 1) : (run.start, run.length + 1)
                if run.length > best.length { best = run }
            } else {
                run = (-1, 0)
            }
        }
        guard best.length >= Int(panel.height * scale) / 2 else { return nil }
        let rowStarts = starts[best.start..<(best.start + best.length)].sorted()
        let at = (x: rowStarts[rowStarts.count / 2], y: best.start)
        // A panel is darker than the face in every theme. A wrong guess at the
        // face (a display's own ground) passes the face itself off as panel.
        var darker = 0, all = 0
        for y in stride(from: at.y, to: min(height, at.y + Int(panel.height * scale)), by: 2) {
            let row = pixels + y * bytesPerRow
            for x in stride(from: at.x, to: min(width, at.x + panelWidth), by: 2) {
                if Int(max(row[x * 4], row[x * 4 + 1], row[x * 4 + 2])) < face - 3 { darker += 1 }
                all += 1
            }
        }
        return darker * 2 > all ? at : nil
    }

    // MARK: - Needle

    /// The dB a needle shows in a BGRA picture holding its panel, or nil when
    /// it holds no panel or no needle. `panelAt` is the panel's corner, if known.
    static func reading(
        pixels: UnsafePointer<UInt8>, width: Int, height: Int, bytesPerRow: Int,
        scale: Double, shape: NeedleShape, panelAt: (x: Int, y: Int)? = nil
    ) -> Double? {
        guard let origin = panelAt ?? locatePanel(pixels: pixels, width: width, height: height,
                                                  bytesPerRow: bytesPerRow, scale: scale, panel: shape.panel.size)
        else { return nil }
        let x0 = max(0, origin.x), y0 = max(0, origin.y)
        let x1 = min(width, origin.x + Int(shape.panel.width * scale))
        let y1 = min(height, origin.y + Int(shape.panel.height * scale))
        var sx = 0.0, sy = 0.0, count = 0
        for y in y0..<max(y0, y1) {
            let row = pixels + y * bytesPerRow
            for x in x0..<max(x0, x1) {
                let p = row + x * 4
                if isNeedle(b: p[0], g: p[1], r: p[2]) {
                    sx += Double(x); sy += Double(y); count += 1
                }
            }
        }
        guard count >= 6 else { return nil }
        // The needle's centroid lies on the needle, which passes through the pivot.
        let pivot = shape.pivotInPanel
        let cx = (sx / Double(count) - Double(origin.x)) / scale - pivot.x
        let cy = (sy / Double(count) - Double(origin.y)) / scale - pivot.y
        let degrees = atan2(cx, -cy) * 180 / .pi
        let db = shape.dbAtUp + shape.dbPerDegree * degrees
        return min(max(db, shape.range.lowerBound), shape.range.upperBound)
    }

    // MARK: - Spectrum

    /// The standard grid's bands (`bandCount`, dB) a spectrum shows in a BGRA
    /// picture holding its display, or nil when it holds no display. Each
    /// band is its loudest column; a column's level is its fill's top edge.
    /// The curve over it is skipped: a fill top hidden under the curve reads
    /// the first fill row below it (≈ 2 dB low), since a curve diving through
    /// the fill (a cut's slope) would otherwise read as level.
    static func spectrum(
        pixels: UnsafePointer<UInt8>, width: Int, height: Int, bytesPerRow: Int,
        scale: Double, shape: SpectrumShape, panelAt: (x: Int, y: Int)? = nil
    ) -> [Double]? {
        guard let origin = panelAt ?? locatePanel(pixels: pixels, width: width, height: height,
                                                  bytesPerRow: bytesPerRow, scale: scale, panel: shape.panel)
        else { return nil }
        let columns = Int(shape.panel.width * scale)
        let rows = Int(shape.height * scale)
        // Each column's top: its first fill pixel with fill under it too. A fill
        // is solid down to the floor; a curve's blended edge or a grid line
        // that passes for fill is a line with the dark ground under it.
        var top = [Int](repeating: Int.max, count: columns)
        func fill(_ x: Int, _ y: Int) -> Bool {
            guard x >= 0, x < width, y >= 0, y < height else { return false }
            let p = pixels + y * bytesPerRow + x * 4
            return isFill(b: p[0], g: p[1], r: p[2], min: shape.fillMin)
        }
        let below = max(1, Int(scale.rounded()))
        for c in 0..<columns {
            let x = origin.x + c
            for r in 0..<rows where fill(x, origin.y + r) && fill(x, origin.y + r + below) {
                top[c] = r
                break
            }
        }
        // The label columns read the first column right of them, the border's
        // last columns the last one inside it.
        let labels = min(columns - 1, Int(shape.labelColumns * scale))
        if labels > 0 { for c in 0..<labels { top[c] = top[labels] } }
        let edge = 2 * max(1, Int(scale.rounded()))
        if columns > edge + 1 { for c in (columns - edge)..<columns { top[c] = top[columns - edge - 1] } }
        return (0..<bandCount).map { i in
            let (lo, hi) = bandEdges(i)
            let c0 = Int((log10(lo / shape.hzAtLeft) * shape.pointsPerDecade * scale).rounded(.down))
            let c1 = max(c0 + 1, Int((log10(hi / shape.hzAtLeft) * shape.pointsPerDecade * scale).rounded(.up)))
            let first = max(0, c0), last = min(columns, c1)
            let best = first < last ? (first..<last).map { top[$0] }.min() ?? Int.max : Int.max
            guard best != Int.max else { return shape.floorDb }
            let db = shape.dbAtTop - Double(best) / scale / shape.pointsPerDb
            return max(shape.floorDb, min(shape.dbAtTop, (db * 10).rounded() / 10))
        }
    }
    // MARK: - Activity

    /// An activity view's heights in a BGRA picture holding its display, or
    /// nil when it holds none: the threshold, then `columns` heights of the
    /// signal's fill, then `columns` of the line (−1 where a column has none).
    /// The graph is the space between the display's two rules, the longest
    /// gap between neutral rows drawn straight across it.
    static func activity(
        pixels: UnsafePointer<UInt8>, width: Int, height: Int, bytesPerRow: Int,
        scale: Double, shape: ActivityShape, panelAt: (x: Int, y: Int)? = nil
    ) -> [Double]? {
        guard let origin = panelAt ?? locatePanel(pixels: pixels, width: width, height: height,
                                                  bytesPerRow: bytesPerRow, scale: scale, panel: shape.panel)
        else { return nil }
        let pw = Int(shape.panel.width * scale), ph = Int(shape.panel.height * scale)
        func px(_ x: Int, _ y: Int) -> (r: Int, g: Int, b: Int) {
            let p = pixels + y * bytesPerRow + x * 4
            return (Int(p[2]), Int(p[1]), Int(p[0]))
        }
        let ys = max(0, origin.y - ph / 4)..<min(height, origin.y + ph + ph / 4)
        let xs = max(0, origin.x + pw / 10)..<min(width, origin.x + pw * 9 / 10)
        guard !xs.isEmpty else { return nil }
        // A rule: one row of one neutral grey straight across, lighter than
        // the ground, and unlike the rows on either side of it (a loud stretch
        // fills rows edge to edge too, but row after row of them).
        var rules: [Int] = []
        for y in ys where y > 0 && y < height - 1 {
            let first = px(xs.lowerBound, y)
            guard max(first.r, first.g, first.b) - min(first.r, first.g, first.b) <= 4, first.g > 40 else { continue }
            func same(_ p: (r: Int, g: Int, b: Int)) -> Bool { abs(p.r - first.r) <= 3 && abs(p.g - first.g) <= 3 && abs(p.b - first.b) <= 3 }
            guard xs.allSatisfy({ same(px($0, y)) }) else { continue }
            let unlike = xs.count * 8 / 10
            if xs.filter({ !same(px($0, y - 1)) }).count >= unlike && xs.filter({ !same(px($0, y + 1)) }).count >= unlike {
                rules.append(y)
            }
        }
        var top = -1, bottom = -1
        for (a, b) in zip(rules, rules.dropFirst()) where b - a > bottom - top { top = a; bottom = b }
        guard top >= 0, bottom - top >= ph / 2 else { return nil }
        // The rule's own run gives the graph's sides.
        let level = px(xs.lowerBound, top)
        func onRule(_ x: Int) -> Bool { let p = px(x, top); return abs(p.g - level.g) <= 3 && abs(p.r - level.r) <= 3 }
        var x0 = xs.lowerBound, x1 = xs.lowerBound
        while x0 > 0 && onRule(x0 - 1) { x0 -= 1 }
        while x1 < width - 1 && onRule(x1 + 1) { x1 += 1 }
        let floorRow = bottom - 1, topRow = top + 1
        let span = Double(max(1, floorRow - topRow))
        func heightOf(_ y: Int) -> Double { ((Double(floorRow - y) / span) * 1000).rounded() / 1000 }
        func isFill(_ p: (r: Int, g: Int, b: Int)) -> Bool {
            max(p.r, p.g, p.b) - min(p.r, p.g, p.b) <= 6 && p.g >= 60 && p.g < 160
        }
        // Orange, its blended edge included (≈ 154 101 54 where it straddles two rows).
        func isLine(_ p: (r: Int, g: Int, b: Int)) -> Bool { p.r >= 90 && p.r - p.b >= p.r * 2 / 5 && p.g > p.b && p.r > p.g }
        func isThreshold(_ p: (r: Int, g: Int, b: Int)) -> Bool { p.b > 150 && p.g > 120 && p.b - p.r > 90 }
        var fills: [Double] = [], lines: [Double] = [], thresholds: [Int] = []
        let n = shape.columns, w = Double(x1 - x0 + 1)
        // The line is followed column to column: Live writes the reduction's
        // number in the same orange at the display's foot, apart from the line.
        let reach = max(3, (floorRow - topRow) / 4)
        var lineRow: Int?
        for i in 0..<n {
            let x = min(x1, x0 + Int((Double(i) + 0.5) * w / Double(n)))
            var fill = 0.0, sawThreshold = i % 16 != 8
            var runs: [Int] = []
            var inRun = false
            for y in topRow...floorRow {
                let p = px(x, y)
                let orange = isLine(p)
                if orange && !inRun { runs.append(y) }
                inRun = orange
                // A fill is solid below its top; the zero line's dots are not.
                if fill == 0 && isFill(p) && y < floorRow && isFill(px(x, y + 1)) { fill = heightOf(y) }
                if !sawThreshold && isThreshold(p) { thresholds.append(y); sawThreshold = true }
            }
            var row: Int?
            if let prev = lineRow {
                row = runs.min { abs($0 - prev) < abs($1 - prev) }.flatMap { abs($0 - prev) <= reach ? $0 : nil }
            } else {
                row = runs.first
            }
            if let row { lineRow = row }
            fills.append(fill)
            lines.append(row.map(heightOf) ?? -1)
        }
        let threshold = thresholds.isEmpty ? -1 : heightOf(thresholds.sorted()[thresholds.count / 2])
        return [threshold] + fills + lines
    }
}
