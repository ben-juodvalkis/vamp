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
