import CoreGraphics
import Foundation

/// Where a device draws its gain-reduction meter, and how to read it
/// (ADR-541). Live puts no reduction on the LOM; Vamp for Mac reads the
/// needle Live draws. Pure, so the tests can feed it a drawn meter.
struct ReductionMeterShape: Equatable {
    /// The meter's dark panel, in points from the device's top-left corner
    /// (the Accessibility frame of `TrackDeviceChainView.Device[n]`). Only
    /// its size is trusted: the panel is found in the picture, since
    /// ScreenCaptureKit's window coordinates and Accessibility's can differ
    /// by the window's origin (measured: by 33 pt in a full-height window).
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

enum ReductionMeter {
    /// Measured on Live 13.0b25 at 100% zoom (2026-11-16), from five needle
    /// positions on a steady tone: the needles meet at one pivot to 0.03 px,
    /// and the ticks (0 5 10 15 20) are 25.0° apart, 10 straight up.
    static let shapes: [String: ReductionMeterShape] = [
        "GlueCompressor": ReductionMeterShape(
            // The panel's corner as `locatePanel` finds it (its top 2 pt are a
            // lighter rim), so the pivot is measured from the same point.
            panel: CGRect(x: 93, y: 25, width: 139, height: 77),
            pivot: CGPoint(x: 162.75, y: 110.7),
            dbAtUp: 10, dbPerDegree: 0.2, range: 0...20)
    ]

    /// Fewer needle pixels than this and there is no needle in the picture.
    static let minimumPixels = 6

    /// Is this BGRA pixel the needle? Live draws it in its accent cyan
    /// (`GainReductionLineColor`) while its window is active and near-white
    /// while it is not (measured: ≥ 190 in each channel, where the panel's
    /// ticks and labels stay below). Loose enough for a 1 px needle blended
    /// with the panel at one pixel per point.
    @inline(__always)
    static func isNeedle(b: UInt8, g: UInt8, r: UInt8) -> Bool {
        (Int(b) - Int(r) > 60 && Int(g) - Int(r) > 50 && b > 110) || (r >= 190 && g >= 190 && b >= 190)
    }

    /// Part of the panel: its dark grey (≈ 38–44), the grey ticks and labels
    /// on it, or the needle; not the lighter device face around it (≈ 170+).
    @inline(__always)
    static func isPanel(b: UInt8, g: UInt8, r: UInt8) -> Bool {
        (r < 150 && g < 150 && b < 150) || isNeedle(b: b, g: g, r: r)
    }

    /// The panel's top-left corner in a BGRA picture taken at `scale`
    /// pixels per point, or nil when no panel-sized dark area is in it.
    static func locatePanel(
        pixels: UnsafePointer<UInt8>, width: Int, height: Int, bytesPerRow: Int,
        scale: Double, shape: ReductionMeterShape
    ) -> (x: Int, y: Int)? {
        let panelWidth = Int(shape.panel.width * scale)
        let need = panelWidth * 85 / 100
        // Per row, the longest dark run; a panel row's is about the panel's width.
        // The longest stack of such rows is the panel, and its runs' commonest
        // start its left edge (a level meter beside it is dark, but narrow).
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
        guard best.length >= Int(shape.panel.height * scale) / 2 else { return nil }
        let rowStarts = starts[best.start..<(best.start + best.length)].sorted()
        return (rowStarts[rowStarts.count / 2], best.start)
    }

    /// The reduction in dB shown by a BGRA picture taken at `scale` pixels
    /// per point that holds the meter's panel, or nil when it holds no panel
    /// or no needle. `panelAt` is the panel's top-left corner, when known.
    static func reading(
        pixels: UnsafePointer<UInt8>, width: Int, height: Int, bytesPerRow: Int,
        scale: Double, shape: ReductionMeterShape, panelAt: (x: Int, y: Int)? = nil
    ) -> Double? {
        guard let origin = panelAt ?? locatePanel(pixels: pixels, width: width, height: height,
                                                  bytesPerRow: bytesPerRow, scale: scale, shape: shape)
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
        guard count >= minimumPixels else { return nil }
        // The needle's centroid lies on the needle, which passes through the pivot.
        let pivot = shape.pivotInPanel
        let cx = (sx / Double(count) - Double(origin.x)) / scale - pivot.x
        let cy = (sy / Double(count) - Double(origin.y)) / scale - pivot.y
        let degrees = atan2(cx, -cy) * 180 / .pi
        let db = shape.dbAtUp + shape.dbPerDegree * degrees
        return min(max(db, shape.range.lowerBound), shape.range.upperBound)
    }
}
