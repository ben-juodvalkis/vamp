import XCTest

/// Vamp for Mac's supervisor decisions (`SupervisorRules`), from the native
/// apps audit of 2026-10-31: a start slower than the limit left the menu
/// saying "stopped" with Stop greyed out and Start offered, and Start ran a
/// second `npm run ipad` that stopped the first one's servers.
final class SupervisorRulesTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    func testASlowStartStaysStoppableAndIsNotStartedTwice() {
        let late = now.addingTimeInterval(-(SupervisorRules.startLimit + 1))
        let state = SupervisorRules.afterHealth(.starting, pageUp: false, hasChild: true, startedAt: late, now: now)
        guard case .failed = state else { return XCTFail("a start past the limit is reported, got \(state)") }
        XCTAssertTrue(SupervisorRules.canStop(state, fromNpm: false, hasChild: true), "Stop stays offered while it runs")
        XCTAssertFalse(SupervisorRules.canStart(state, fromNpm: false, hasRepo: true, hasChild: true), "no second npm run ipad")
    }

    func testASlowStartThatAnswersAfterAllIsRunning() {
        let state = SupervisorRules.afterHealth(.failed("slow"), pageUp: true, hasChild: true, startedAt: nil, now: now)
        XCTAssertEqual(state, .running)
    }

    func testServersWithNothingOfOursUnderThemAreSomeoneElses() {
        XCTAssertEqual(SupervisorRules.afterHealth(.stopped, pageUp: true, hasChild: false, startedAt: nil, now: now), .external)
        XCTAssertEqual(SupervisorRules.afterHealth(.failed("x"), pageUp: true, hasChild: false, startedAt: nil, now: now), .external)
        XCTAssertEqual(SupervisorRules.afterHealth(.external, pageUp: false, hasChild: false, startedAt: nil, now: now), .stopped)
        XCTAssertFalse(SupervisorRules.canStop(.external, fromNpm: false, hasChild: false))
    }

    func testStartAndStopFollowTheChildNotOnlyTheState() {
        XCTAssertTrue(SupervisorRules.canStart(.stopped, fromNpm: false, hasRepo: true, hasChild: false))
        XCTAssertFalse(SupervisorRules.canStart(.stopped, fromNpm: true, hasRepo: true, hasChild: false), "npm's servers are the Terminal's")
        XCTAssertFalse(SupervisorRules.canStart(.stopped, fromNpm: false, hasRepo: false, hasChild: false))
        XCTAssertTrue(SupervisorRules.canStop(.running, fromNpm: false, hasChild: true))
        XCTAssertFalse(SupervisorRules.canStop(.running, fromNpm: false, hasChild: false))
    }

    func testAnExitRestartsUntilItKeepsHappening() {
        var exits: [Date] = []
        for n in 1...SupervisorRules.restartLimit {
            let decision = SupervisorRules.afterExit(recentExits: exits, now: now, pageUp: false)
            XCTAssertTrue(decision.restart, "exit \(n) restarts")
            exits = decision.exits
        }
        XCTAssertFalse(SupervisorRules.afterExit(recentExits: exits, now: now, pageUp: false).restart)
        // Exits older than the window are forgotten.
        let later = now.addingTimeInterval(SupervisorRules.restartWindow + 1)
        XCTAssertTrue(SupervisorRules.afterExit(recentExits: exits, now: later, pageUp: false).restart)
    }

    func testAnExitIsNotRestartedOverSomeoneElsesServers() {
        // A Terminal's npm run ipad came up meanwhile: starting ours would
        // run cleanup.sh over it.
        XCTAssertFalse(SupervisorRules.afterExit(recentExits: [], now: now, pageUp: true).restart)
    }

    // MARK: - The progress screen's steps

    func testTheStartsOwnOutputMovesTheSteps() {
        XCTAssertEqual(SupervisorRules.startStep(after: "📦 Preparing the iPad app..."), .preparing)
        XCTAssertEqual(SupervisorRules.startStep(after: "🔨 Building the iPad app — about 40 s, and only when the code has changed (inputs changed)"), .building)
        XCTAssertEqual(SupervisorRules.startStep(after: "⚡ Vite build skipped — inputs unchanged (fingerprint 26ms)"), .startingServers)
        XCTAssertEqual(SupervisorRules.startStep(after: "🎵 Starting OSC bridge..."), .startingServers)
        XCTAssertEqual(SupervisorRules.startStep(after: "[PREVIEW]   ➜  Local:   http://localhost:8889/"), .loading)
        // The banner's own "Mac: http://localhost:8889" is not the server answering.
        XCTAssertNil(SupervisorRules.startStep(after: "   🖥️  Mac: http://localhost:8889"))
    }

    func testTheBuildTimeIsReadForNextTime() {
        XCTAssertEqual(SupervisorRules.buildSeconds(in: "✅ Vite build complete in 9.6s"), 9.6)
        XCTAssertNil(SupervisorRules.buildSeconds(in: "✓ built in 7ms"))
    }

    func testTheBarOnlyFillsForwardAndStaysInsideEachStep() {
        var last = -1.0
        for step in [StartStep.preparing, .building, .startingServers, .loading] {
            for t in [0.0, 1, 5, 10, 30, 600] {
                let f = SupervisorRules.startFraction(step, secondsInStep: t, buildEstimate: 10)
                XCTAssertGreaterThanOrEqual(f, last, "\(step) at \(t) s")
                last = f
            }
        }
        XCTAssertLessThan(last, 1, "full only once the page has drawn")
        // A slow build still leaves room for the steps after it.
        XCTAssertLessThan(SupervisorRules.startFraction(.building, secondsInStep: 600, buildEstimate: 10), 0.80 + 1e-9)
    }
}
