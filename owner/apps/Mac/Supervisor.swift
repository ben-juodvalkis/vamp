import AppKit
import Darwin
import Foundation

/// Runs Vamp from the menu bar: what `npm run ipad` does in a Terminal —
/// Live, the gated build, the bridge and the page server, each restarted
/// by `concurrently` if it dies — started here as a child process, its
/// output in `logs/vamp-mac.log`.
///
/// Opened from the Dock, the app starts Vamp at once. Started by
/// `npm run ipad` / `npm run dev` (`VAMP_FROM_NPM=1`, set by
/// scripts/launch-menubar.sh), the Terminal owns the servers and this
/// only reports them. Either way, servers already answering when it looks
/// are someone else's, and are left alone — unless they are the ones this
/// app started before it crashed or was force-quit, which it takes back.
///
/// The decisions are `SupervisorRules`, where the tests reach them.
@MainActor
final class Supervisor: ObservableObject {
    typealias State = SupervisorState

    @Published private(set) var state: State = .stopped
    /// The page server answers on `pagePort`.
    @Published private(set) var pageUp = false
    /// Said in the menu until a self-update succeeds: the last one failed,
    /// and the app runs the copy installed before it.
    @Published private(set) var updateNote: String?

    let repoRoot: URL?
    let pagePort: UInt16
    let fromNpm: Bool

    private var child: Process?
    /// An `npm run ipad` this app started before it crashed or was
    /// force-quit, found again at launch (its pid and start time were
    /// recorded): stopped and watched like `child`.
    private var adopted: pid_t?
    private var stopRequested = false
    private var healthTimer: Timer?
    private var starting: Date?
    private var recentExits: [Date] = []

    /// How long a self-update may take before it is given up on.
    static let updateLimit: TimeInterval = 300

    /// For the app delegate's quit hook, which has no view to hold it.
    static weak var current: Supervisor?

    init(config: AppConfig) {
        repoRoot = config.repoRoot
        pagePort = config.padPagePort
        fromNpm = ProcessInfo.processInfo.environment["VAMP_FROM_NPM"] == "1"
        VampLog.url = repoRoot?.appendingPathComponent("logs/vamp-mac.log")
        Self.current = self
        healthTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.checkHealth() }
        }
        Task { @MainActor in
            if !fromNpm, let pid = Self.recordedChild() {
                adopted = pid
                state = .starting
                starting = Date()
                VampLog.line("— Vamp for Mac took back the npm run ipad it started before (pid \(pid)) —")
            }
            await checkHealth()
            if !fromNpm && !pageUp && !hasChild {
                // A rebuilt app relaunches itself and starts Vamp from there.
                if await updateSelfIfStale() { return }
                start()
            }
        }
    }

    var logURL: URL? { VampLog.url }

    private var hasChild: Bool { child != nil || adopted != nil }

    /// The address to open on the iPad in Safari: this Mac's Bonjour name.
    var iPadAddress: String {
        let name = ProcessInfo.processInfo.hostName
        return "http://\(name.hasSuffix(".local") ? name : name + ".local"):\(pagePort)"
    }

    var canStart: Bool {
        SupervisorRules.canStart(state, fromNpm: fromNpm, hasRepo: repoRoot != nil, hasChild: hasChild)
    }

    var canStop: Bool { SupervisorRules.canStop(state, fromNpm: fromNpm, hasChild: hasChild) }

    var statusLine: String {
        switch state {
        case .stopped: return repoRoot == nil ? "Vamp: can't find the repo" : "Vamp: stopped"
        case .updating: return "Vamp: updating Vamp for Mac…"
        case .starting: return "Vamp: starting…"
        case .running: return pageUp ? "Vamp: running" : "Vamp: running, page server restarting…"
        case .stopping: return "Vamp: stopping…"
        case .external: return fromNpm ? "Vamp: running from npm run ipad" : "Vamp: running (started elsewhere)"
        case .failed(let why): return hasChild ? "Vamp: \(why)" : "Vamp: stopped — \(why)"
        }
    }

    // MARK: - Keeping itself current

    /// Opened from the Dock, check this app's own code against the build
    /// installed: `scripts/mac-app-fingerprint.sh` against the fingerprint
    /// `install-mac-app.sh` recorded. If the code changed, rebuild and
    /// replace this app, then relaunch it, which starts Vamp. Returns true
    /// when it relaunches; false to carry on with this copy (current, or the
    /// rebuild failed, which the menu says until an update succeeds).
    private func updateSelfIfStale() async -> Bool {
        guard let root = repoRoot else { return false }
        let defaults = UserDefaults.standard
        let script = root.appendingPathComponent("scripts/mac-app-fingerprint.sh").path
        guard let current = await Self.run(["/bin/bash", script], in: root, log: nil, limit: 30).output,
              !current.isEmpty else { return false }
        if current == defaults.string(forKey: "sourceFingerprint") {
            defaults.removeObject(forKey: "failedFingerprint")
            return false
        }
        // The same code failed to build last time: building it again would
        // fail again and only delay Vamp. The next edit tries afresh.
        if current == defaults.string(forKey: "failedFingerprint") {
            updateNote = "Vamp for Mac's last update failed; see the log"
            return false
        }

        state = .updating
        VampLog.line("— Vamp for Mac's code changed since it was installed: rebuilding it —")
        let update = await Self.run(
            ["/bin/zsh", "-lc", "VAMP_SELF_UPDATE=1 bash scripts/install-mac-app.sh"],
            in: root, log: VampLog.open(), limit: Self.updateLimit
        )
        guard update.status == 0 else {
            let why = update.status == Self.timedOut ? "took over \(Int(Self.updateLimit)) s" : "exit \(update.status)"
            VampLog.line("— the rebuild failed (\(why)); running the copy installed —")
            defaults.set(current, forKey: "failedFingerprint")
            updateNote = "Vamp for Mac's update failed; see the log"
            state = .stopped
            return false
        }
        VampLog.line("— rebuilt: relaunching —")
        // Relaunch once this process has gone, or `open` would only bring
        // this copy forward. Detached: it outlives the app that started it.
        let me = ProcessInfo.processInfo.processIdentifier
        let relaunch = Process()
        relaunch.executableURL = URL(fileURLWithPath: "/bin/sh")
        relaunch.arguments = ["-c", "while kill -0 \(me) 2>/dev/null; do sleep 0.2; done; open /Applications/Vamp.app"]
        try? relaunch.run()
        NSApp.terminate(nil)
        return true
    }

    /// The status `run` reports for a command stopped at its time limit.
    nonisolated static let timedOut: Int32 = -2

    /// Whether a `run` command has ended, and whether its time limit did it:
    /// read and written from its exit handler and its timer, under the lock.
    private final class RunEnd: @unchecked Sendable {
        let lock = NSLock()
        var finished = false
        var stopped = false
    }

    /// Run a command to the end without blocking the main thread; past
    /// `limit` seconds it is stopped (its whole tree) and reports `timedOut`.
    private nonisolated static func run(
        _ argv: [String], in dir: URL, log: FileHandle?, limit: TimeInterval
    ) async -> (status: Int32, output: String?) {
        await withCheckedContinuation { done in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: argv[0])
            process.arguments = Array(argv.dropFirst())
            process.currentDirectoryURL = dir
            let pipe = Pipe()
            if let log {
                process.standardOutput = log
                process.standardError = log
            } else {
                process.standardOutput = pipe
            }
            let end = RunEnd()
            process.terminationHandler = { proc in
                end.lock.lock(); defer { end.lock.unlock() }
                guard !end.finished else { return }
                end.finished = true
                let output = log == nil
                    ? String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    : nil
                done.resume(returning: (end.stopped ? timedOut : proc.terminationStatus, output))
            }
            do { try process.run() } catch {
                end.lock.lock(); end.finished = true; end.lock.unlock()
                done.resume(returning: (-1, nil))
                return
            }
            let pid = process.processIdentifier
            DispatchQueue.global().asyncAfter(deadline: .now() + limit) {
                end.lock.lock()
                let running = !end.finished
                if running { end.stopped = true }
                end.lock.unlock()
                if running { stopTree(pid) }
            }
        }
    }

    // MARK: - Start / stop

    func start() {
        guard canStart, let root = repoRoot else { return }
        stopRequested = false
        state = .starting
        starting = Date()

        let log = VampLog.open()
        let process = Process()
        // A login shell, for the PATH a Terminal would have: an app opened
        // from the Dock gets launchd's bare one, with no node or npm on it.
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", "exec npm run ipad"]
        process.currentDirectoryURL = root
        var env = ProcessInfo.processInfo.environment
        // This app is the menu bar; setup-ipad.js must not launch another.
        env["SKIP_MENUBAR"] = "1"
        // The menu is the status page: setup-ipad.js opens no Safari windows.
        env["VAMP_MAC_APP"] = "1"
        env["LOOPING_PROJECT_ROOT"] = root.path
        // Node 24.7 reading the macOS Keychain's certificates segfaults on a
        // background thread (ReadMacOSKeychainCertificates → X509 null read,
        // crash report 2026-10-30 16:47): a start died with exit 1 after a
        // skipped build. Vamp makes no outbound TLS, so it never needs them.
        env.removeValue(forKey: "NODE_USE_SYSTEM_CA")
        process.environment = env
        if let log {
            process.standardOutput = log
            process.standardError = log
        }
        process.terminationHandler = { [weak self] proc in
            let code = proc.terminationStatus
            Task { @MainActor in self?.childExited(proc, code: code) }
        }
        do {
            try process.run()
            child = process
            Self.recordChild(process.processIdentifier)
            VampLog.line("— Vamp for Mac started npm run ipad (pid \(process.processIdentifier)) —")
        } catch {
            state = .failed("could not start: \(error.localizedDescription)")
        }
    }

    func stop() {
        guard canStop else { return }
        stopRequested = true
        state = .stopping
        if let pid = child?.processIdentifier ?? adopted { Self.stopTree(pid) }
        runCleanup()
    }

    func restart() {
        guard canStop else { start(); return }
        stop()
        Task { @MainActor in
            while state == .stopping { try? await Task.sleep(for: .milliseconds(200)) }
            start()
        }
    }

    /// On quit: stop what this app started, and nothing else.
    func stopForQuit() {
        guard hasChild, !fromNpm else { return }
        stopRequested = true
        if let pid = child?.processIdentifier ?? adopted { Self.stopTree(pid, wait: true) }
        Self.recordChild(nil)
        runCleanup(wait: true)
    }

    /// Stop `root` and everything under it, children first. Terminating
    /// npm alone leaves its children running (measured: setup-ipad.js
    /// outlived it), and a name-pattern kill catches strangers — Max's own
    /// Node inherits npm's environment and reads like part of the stack.
    /// So the tree is walked by parent pid: SIGTERM to all, then SIGKILL to
    /// whatever is still there after up to two seconds. `concurrently`
    /// respawns a child 1.5 s after it dies, outside this list: cleanup.sh,
    /// which runs beside this, is what stops those.
    nonisolated static func stopTree(_ root: pid_t, wait: Bool = false) {
        var order: [pid_t] = []
        func walk(_ pid: pid_t) {
            for child in childPids(of: pid) { walk(child) }
            order.append(pid)
        }
        walk(root)
        for pid in order { kill(pid, SIGTERM) }
        let targets = order
        let reap: @Sendable () -> Void = {
            // Gone as soon as they are gone, at most two seconds.
            for _ in 0..<20 where targets.contains(where: { kill($0, 0) == 0 }) {
                Thread.sleep(forTimeInterval: 0.1)
            }
            for pid in targets where kill(pid, 0) == 0 { kill(pid, SIGKILL) }
        }
        if wait { reap() } else { DispatchQueue.global().async(execute: reap) }
    }

    nonisolated static func childPids(of pid: pid_t) -> [pid_t] {
        let count = proc_listchildpids(pid, nil, 0)
        guard count > 0 else { return [] }
        var pids = [pid_t](repeating: 0, count: Int(count) * 2)
        let filled = proc_listchildpids(pid, &pids, Int32(pids.count * MemoryLayout<pid_t>.size))
        guard filled > 0 else { return [] }
        return Array(pids.prefix(Int(filled))).filter { $0 > 0 }
    }

    /// `process` exited by itself (nil: the adopted one, found gone).
    private func childExited(_ process: Process?, code: Int32) {
        // An earlier child's exit arriving after a new one started is that
        // child's news, not the current one's.
        if let process, process !== child { return }
        child = nil
        adopted = nil
        Self.recordChild(nil)
        VampLog.line("— npm run ipad exited\(process == nil ? "" : " with \(code)") —")
        if stopRequested {
            state = .stopped
            return
        }
        // Not asked to stop: start it again, unless it keeps dying, which
        // restarting will not fix (a build error, a port held elsewhere), or
        // someone else's servers answer now.
        Task { @MainActor in
            let up = await pageAnswers()
            let decision = SupervisorRules.afterExit(recentExits: recentExits, now: Date(), pageUp: up)
            recentExits = decision.exits
            state = .failed("npm run ipad exited; see the log")
            guard decision.restart else {
                VampLog.line(up
                    ? "— not restarting: the page server answers, started elsewhere —"
                    : "— not restarting: \(recentExits.count) exits in \(Int(SupervisorRules.restartWindow)) s —")
                if up { state = .external }
                return
            }
            VampLog.line("— restarting in \(Int(SupervisorRules.restartDelay)) s —")
            try? await Task.sleep(for: .seconds(SupervisorRules.restartDelay))
            if case .failed = state, !hasChild { start() }
        }
    }

    /// scripts/cleanup.sh stops this repo's servers and frees their ports,
    /// whatever outlived the child: concurrently's own children among them.
    private func runCleanup(wait: Bool = false) {
        guard let root = repoRoot else {
            if !wait { state = .stopped }
            return
        }
        let cleanup = Process()
        cleanup.executableURL = URL(fileURLWithPath: "/bin/zsh")
        cleanup.arguments = ["-lc", "./scripts/cleanup.sh"]
        cleanup.currentDirectoryURL = root
        if let log = VampLog.open() {
            cleanup.standardOutput = log
            cleanup.standardError = log
        }
        cleanup.terminationHandler = { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                // The adopted tree has no exit handler: this is its end.
                if self.adopted != nil {
                    self.adopted = nil
                    Self.recordChild(nil)
                }
                if !self.hasChild && self.state == .stopping { self.state = .stopped }
            }
        }
        try? cleanup.run()
        if wait { cleanup.waitUntilExit() }
    }

    // MARK: - The child, across a crash

    /// Remember the child (its pid and start time), so a copy of this app
    /// launched after a crash or a force-quit can take it back; nil forgets.
    private static func recordChild(_ pid: pid_t?) {
        let defaults = UserDefaults.standard
        guard let pid, let started = processStart(pid) else {
            defaults.removeObject(forKey: "childPid")
            defaults.removeObject(forKey: "childStart")
            return
        }
        defaults.set(Int(pid), forKey: "childPid")
        defaults.set(Int(started), forKey: "childStart")
    }

    /// The recorded child, if that very process is still running: the same
    /// pid AND the same start time, since pids are reused.
    private static func recordedChild() -> pid_t? {
        let defaults = UserDefaults.standard
        let pid = pid_t(defaults.integer(forKey: "childPid"))
        let started = UInt64(defaults.integer(forKey: "childStart"))
        guard pid > 0, started > 0, processStart(pid) == started else {
            recordChild(nil)
            return nil
        }
        return pid
    }

    /// When `pid` started (seconds since 1970), or nil when it is not running.
    private static func processStart(_ pid: pid_t) -> UInt64? {
        var info = proc_bsdinfo()
        let size = Int32(MemoryLayout<proc_bsdinfo>.size)
        guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { return nil }
        return info.pbi_start_tvsec
    }

    // MARK: - Health

    private func checkHealth() async {
        if let pid = adopted, kill(pid, 0) != 0, state != .stopping {
            childExited(nil, code: 0)
        }
        let up = await pageAnswers()
        pageUp = up
        state = SupervisorRules.afterHealth(state, pageUp: up, hasChild: hasChild, startedAt: starting, now: Date())
    }

    private func pageAnswers() async -> Bool {
        guard let url = URL(string: "http://127.0.0.1:\(pagePort)/") else { return false }
        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        request.timeoutInterval = 1.5
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return (response as? HTTPURLResponse).map { $0.statusCode < 500 } ?? false
        } catch {
            return false
        }
    }

    // MARK: - Menu actions

    func showLog() {
        guard let url = logURL else { return }
        if !FileManager.default.fileExists(atPath: url.path) { VampLog.line("— log opened —") }
        NSWorkspace.shared.open(url)
    }

    func copyIPadAddress() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(iPadAddress, forType: .string)
    }
}
