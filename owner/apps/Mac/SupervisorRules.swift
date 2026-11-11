import Foundation

/// What Vamp for Mac's supervisor decides, apart from the processes it
/// decides about: pure functions of its state, so the tests can drive every
/// case (a start slower than the limit, a server someone else started, an
/// exit that keeps happening) without starting anything.
enum SupervisorState: Equatable {
    case stopped
    case starting
    case running
    case stopping
    /// Up, but not started here (a Terminal's `npm run ipad`).
    case external
    /// Something went wrong; the log says what. The child may still be
    /// running (a start slower than the limit), which `hasChild` says.
    case failed(String)
    /// Rebuilding and replacing itself before it starts Vamp.
    case updating
}

enum SupervisorRules {
    /// How long a start may take before a page server that never answers
    /// counts as a failure: the gated build is ~40 s when the code changed.
    static let startLimit: TimeInterval = 180

    /// An unexpected exit is restarted after `restartDelay`, at most
    /// `restartLimit` times in `restartWindow`.
    static let restartDelay: TimeInterval = 3
    static let restartLimit = 3
    static let restartWindow: TimeInterval = 120

    /// Start is offered only with nothing of ours running: a second
    /// `npm run ipad` would stop the first one's servers (its first step is
    /// cleanup.sh) and leave the app holding the wrong process.
    static func canStart(_ state: SupervisorState, fromNpm: Bool, hasRepo: Bool, hasChild: Bool) -> Bool {
        guard !fromNpm, hasRepo, !hasChild else { return false }
        switch state {
        case .stopped, .failed: return true
        default: return false
        }
    }

    /// Stop is offered whenever something of ours is running, whatever the
    /// state says: a start past its limit is still running.
    static func canStop(_ state: SupervisorState, fromNpm: Bool, hasChild: Bool) -> Bool {
        guard !fromNpm, hasChild else { return false }
        switch state {
        case .starting, .running, .failed: return true
        default: return false
        }
    }

    /// The state after a health check: whether the page server answers,
    /// whether a child of ours is running, and since when it has been starting.
    static func afterHealth(
        _ state: SupervisorState, pageUp: Bool, hasChild: Bool, startedAt: Date?, now: Date
    ) -> SupervisorState {
        switch state {
        case .stopped:
            return pageUp && !hasChild ? .external : state
        case .failed:
            // A slow start that answered after all is running; a server
            // that answers with nothing of ours under it is someone else's.
            if pageUp { return hasChild ? .running : .external }
            return state
        case .external:
            return pageUp ? state : .stopped
        case .starting:
            if pageUp { return .running }
            if let startedAt, now.timeIntervalSince(startedAt) > startLimit {
                return .failed("the page server has not answered in \(Int(startLimit)) s; still trying, see the log")
            }
            return state
        case .running, .stopping, .updating:
            return state
        }
    }

    /// The exits still inside the restart window, with this one added, and
    /// whether to start again: not past the limit, and not when the page
    /// server answers anyway (someone else's servers came up, and starting
    /// ours would stop theirs).
    static func afterExit(
        recentExits: [Date], now: Date, pageUp: Bool
    ) -> (exits: [Date], restart: Bool) {
        let exits = recentExits.filter { now.timeIntervalSince($0) < restartWindow } + [now]
        return (exits, exits.count <= restartLimit && !pageUp)
    }
}

/// Where a start has got to, read from the child's output in the log; the
/// Vamp window's progress screen says it and fills its bar from it.
enum StartStep: Int, Comparable {
    case preparing
    case building
    case startingServers
    case loading

    static func < (a: StartStep, b: StartStep) -> Bool { a.rawValue < b.rawValue }

    var label: String {
        switch self {
        case .preparing: return "Starting Vamp…"
        case .building: return "Building the interface…"
        case .startingServers: return "Starting the bridge…"
        case .loading: return "Loading the interface…"
        }
    }
}

extension SupervisorRules {
    /// The step a line of `npm run ipad`'s output moves the start to, or nil.
    /// The markers are scripts/setup-ipad.js's and scripts/staleness.mjs's.
    static func startStep(after line: String) -> StartStep? {
        if line.contains("Preparing the iPad app") { return .preparing }
        if line.contains("Building the iPad app") { return .building }
        if line.contains("Vite build skipped") || line.contains("Starting OSC bridge") { return .startingServers }
        if line.contains("[PREVIEW]") && line.contains("Local:") { return .loading }
        return nil
    }

    /// The build's own time, from "✅ Vite build complete in 9.6s".
    static func buildSeconds(in line: String) -> Double? {
        guard let range = line.range(of: #"Vite build complete in ([0-9.]+)s"#, options: .regularExpression) else { return nil }
        let number = line[range].dropFirst("Vite build complete in ".count).dropLast()
        return Double(number)
    }

    /// How full the bar is: each step owns a span of it and fills that span
    /// over its expected time, slowing as it nears the end so a long step
    /// never reaches the next one's span before its marker does.
    static func startFraction(_ step: StartStep, secondsInStep: Double, buildEstimate: Double) -> Double {
        let (from, to, expected): (Double, Double, Double) = switch step {
        case .preparing: (0.0, 0.08, 3)
        case .building: (0.08, 0.80, max(buildEstimate, 1))
        case .startingServers: (0.80, 0.92, 3)
        case .loading: (0.92, 0.99, 2)
        }
        // Steady to 85% of the span at the expected time, then easing toward its end.
        let t = max(secondsInStep, 0)
        let filled = t <= expected ? 0.85 * t / expected : 0.85 + 0.15 * (1 - exp(-(t - expected) / expected))
        return from + (to - from) * filled
    }
}
