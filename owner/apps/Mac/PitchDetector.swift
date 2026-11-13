import Foundation

/// The tuner's pitch (ADR-539): YIN over a window of one input's recent
/// samples. Pure, so the tests can feed it a sine.
enum PitchDetector {
    /// The lowest and highest pitch it looks for: below a 5-string bass's
    /// low B (31 Hz) is out of reach of a 2048-sample window, so 40 Hz, and
    /// a guitar's 24th fret high E is 1319 Hz.
    static let lowest: Double = 40
    static let highest: Double = 1500
    /// Quieter than this (peak, −50 dBFS) and there is nothing to tune.
    static let floor: Float = 0.00316
    /// YIN's absolute threshold: the first dip of the normalised difference
    /// below it is the period.
    static let threshold: Float = 0.15

    /// The pitch in Hz of `samples` at `rate`, and how clear it is (0–1),
    /// or nil for silence or noise.
    static func detect(_ samples: [Float], rate: Double) -> (hz: Double, clarity: Double)? {
        let n = samples.count
        guard n >= 64, rate > 0 else { return nil }
        var peak: Float = 0
        for s in samples { peak = max(peak, abs(s)) }
        guard peak >= floor else { return nil }

        let maxTau = min(n / 2, Int(rate / lowest))
        let minTau = max(2, Int(rate / highest))
        guard maxTau > minTau + 2 else { return nil }
        let w = n - maxTau

        // The difference function, then its cumulative-mean normalisation.
        var d = [Float](repeating: 0, count: maxTau + 1)
        samples.withUnsafeBufferPointer { x in
            for tau in 1...maxTau {
                var sum: Float = 0
                var i = 0
                while i < w {
                    let v = x[i] - x[i + tau]
                    sum += v * v
                    i += 1
                }
                d[tau] = sum
            }
        }
        var running: Float = 0
        d[0] = 1
        for tau in 1...maxTau {
            running += d[tau]
            d[tau] = running > 0 ? d[tau] * Float(tau) / running : 1
        }

        // The first dip under the threshold, followed to its bottom.
        var tau = minTau
        var found = -1
        while tau < maxTau {
            if d[tau] < threshold {
                while tau + 1 < maxTau && d[tau + 1] < d[tau] { tau += 1 }
                found = tau
                break
            }
            tau += 1
        }
        guard found > 0 else { return nil }

        // Parabolic interpolation between the neighbours for sub-sample period.
        var period = Double(found)
        if found > 1 && found < maxTau {
            let a = Double(d[found - 1]), b = Double(d[found]), c = Double(d[found + 1])
            let denom = a - 2 * b + c
            if denom != 0 { period += 0.5 * (a - c) / denom }
        }
        let hz = rate / period
        guard hz >= lowest, hz <= highest else { return nil }
        return (hz, Double(max(0, min(1, 1 - d[found]))))
    }
}
