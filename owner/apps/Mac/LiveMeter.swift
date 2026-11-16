import CoreGraphics
import Foundation

/// What Live draws in a device's panel that the LOM does not carry, read off
/// Live's window (ADR-541): a **needle** (the Glue's gain reduction) or a
/// **spectrum** (the Auto Filter's). Each device class names its kind and
/// the measured geometry; the readers below are pure, so the tests can feed
/// them pictures. Adding a device is a measured entry in `kinds`.
enum LiveMeterKind: Equatable {
    case needle(NeedleShape)
    case spectrum(SpectrumShape)

    /// The panel the kind draws in, in points; only its size is used to find
    /// it in a picture (`LiveMeter.locatePanel`).
    var panel: CGSize {
        switch self {
        case .needle(let s): return s.panel.size
        case .spectrum(let s): return s.panel
        }
    }

    /// The wire name of what it reads: `reduction` or `spectrum`.
    var name: String {
        switch self {
        case .needle: return "reduction"
        case .spectrum: return "spectrum"
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
            labelColumns: 22))
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

    /// Part of a panel: its dark grey (≈ 32–44), the grey ticks, labels and
    /// fills on it, or a needle; not the lighter device face around it (≈ 170+).
    @inline(__always)
    static func isPanel(b: UInt8, g: UInt8, r: UInt8) -> Bool {
        (r < 150 && g < 150 && b < 150) || isNeedle(b: b, g: g, r: r)
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
    /// point, or nil when no panel-sized dark area is in it. Per row, the
    /// longest dark run; a panel row's is about the panel's width. The longest
    /// stack of such rows is the panel, and its runs' commonest start its left
    /// edge (a level meter beside it is dark, but narrow).
    static func locatePanel(
        pixels: UnsafePointer<UInt8>, width: Int, height: Int, bytesPerRow: Int,
        scale: Double, panel: CGSize
    ) -> (x: Int, y: Int)? {
        let panelWidth = Int(panel.width * scale)
        let need = panelWidth * 85 / 100
        var best = (start: -1, length: 0), run = (start: -1, length: 0)
        var starts = [Int](repeating: -1, count: height)
        for y in 0..<height {
            let row = pixels + y * bytesPerRow
            var longest = (start: 0, length: 0), current = (start: 0, length: 0)
            for x in 0..<width {
                if isPanel(b: row[x * 4], g: row[x * 4 + 1], r: row[x * 4 + 2]) {
                    current = current.length == 0 ? (x, 1) : (current.start, current.length + 1)
                    if current.length > longest.length { longest = current }
                } else {
                    current = (0, 0)
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
        return (rowStarts[rowStarts.count / 2], best.start)
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
}
