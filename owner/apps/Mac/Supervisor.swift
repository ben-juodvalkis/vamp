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
/// are someone else's, and are left alone.
@MainActor
final class Supervisor: ObservableObject {
    enum State: Equatable {
        case stopped
        case starting
        case running
        case stopping
        /// Up, but not started here (a Terminal's `npm run ipad`).
        case external
        /// The child exited by itself; the log says why.
        case failed(String)
        /// Rebuilding and replacing itself before it starts Vamp.
        case updating
    }

    @Published private(set) var state: State = .stopped
    /// The page server answers on `pagePort`.
    @Published private(set) var pageUp = false

    let repoRoot: URL?
    let pagePort: UInt16
    let fromNpm: Bool

    private var child: Process?
    private var stopRequested = false
    private var healthTimer: Timer?
    private var starting: Date?

    /// How long a start may take before a page server that never answers
    /// counts as a failure: the gated build is ~40 s when the code changed.
    static let startLimit: TimeInterval = 180

    /// An unexpected exit is restarted after `restartDelay`, at most
    /// `restartLimit` times in `restartWindow`.
    static let restartDelay: TimeInterval = 3
    static let restartLimit = 3
    static let restartWindow: TimeInterval = 120
    private var recentExits: [Date] = []

    /// For the app delegate's quit hook, which has no view to hold it.
    static weak var current: Supervisor?

    init(config: AppConfig) {
        repoRoot = config.repoRoot
        pagePort = config.padPagePort
        fromNpm = ProcessInfo.processInfo.environment["VAMP_FROM_NPM"] == "1"
        Self.current = self
        healthTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.checkHealth() }
        }
        Task { @MainActor in
            await checkHealth()
            if !fromNpm && !pageUp {
                // A rebuilt app relaunches itself and starts Vamp from there.
                if await updateSelfIfStale() { return }
                start()
            }
        }
    }

    var logURL: URL? { repoRoot?.appendingPathComponent("logs/vamp-mac.log") }

    /// The address to open on the iPad in Safari: this Mac's Bonjour name.
    var iPadAddress: String {
        let name = ProcessInfo.processInfo.hostName
        return "http://\(name.hasSuffix(".local") ? name : name + ".local"):\(pagePort)"
    }

    var canStart: Bool {
        if fromNpm { return false }
        switch state {
        case .stopped, .failed: return repoRoot != nil
        default: return false
        }
    }

    var canStop: Bool { !fromNpm && (state == .running || state == .starting) }

    var statusLine: String {
        switch state {
        case .stopped: return repoRoot == nil ? "Vamp: can't find the repo" : "Vamp: stopped"
        case .updating: return "Vamp: updating Vamp for Mac…"
        case .starting: return "Vamp: starting…"
        case .running: return pageUp ? "Vamp: running" : "Vamp: running, page server restarting…"
        case .stopping: return "Vamp: stopping…"
        case .external: return fromNpm ? "Vamp: running from npm run ipad" : "Vamp: running (started elsewhere)"
        case .failed(let why): return "Vamp: stopped — \(why)"
        }
    }

    // MARK: - Keeping itself current

    /// Opened from the Dock, check this app's own code against the build
    /// installed: `scripts/mac-app-fingerprint.sh` against the fingerprint
    /// `install-mac-app.sh` recorded. If the code changed, rebuild and
    /// replace this app, then relaunch it, which starts Vamp. Returns true
    /// when it relaunches; false to carry on with this copy (current, or
    /// the rebuild failed, which the log says).
    private func updateSelfIfStale() async -> Bool {
        guard let root = repoRoot else { return false }
        let recorded = UserDefaults.standard.string(forKey: "sourceFingerprint")
        let script = root.appendingPathComponent("scripts/mac-app-fingerprint.sh").path
        guard let current = await Self.run(["/bin/bash", script], in: root, log: nil).output,
              !current.isEmpty else { return false }
        if current == recorded { return false }

        state = .updating
        appendToLog("— Vamp for Mac's code changed since it was installed: rebuilding it —")
        let update = await Self.run(
            ["/bin/zsh", "-lc", "VAMP_SELF_UPDATE=1 bash scripts/install-mac-app.sh"],
            in: root, log: openLog()
        )
        guard update.status == 0 else {
            appendToLog("— the rebuild failed (\(update.status)); running the copy installed —")
            state = .stopped
            return false
        }
        appendToLog("— rebuilt: relaunching —")
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

    /// Run a command to the end without blocking the main thread.
    private nonisolated static func run(
        _ argv: [String], in dir: URL, log: FileHandle?
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
            process.terminationHandler = { proc in
                let output = log == nil
                    ? String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    : nil
                done.resume(returning: (proc.terminationStatus, output))
            }
            do { try process.run() } catch { done.resume(returning: (-1, nil)) }
        }
    }

    // MARK: - Start / stop

    func start() {
        guard canStart, let root = repoRoot else { return }
        stopRequested = false
        state = .starting
        starting = Date()

        let log = openLog()
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
            Task { @MainActor in self?.childExited(code) }
        }
        do {
            try process.run()
            child = process
            appendToLog("— Vamp for Mac started npm run ipad (pid \(process.processIdentifier)) —")
        } catch {
            state = .failed("could not start: \(error.localizedDescription)")
        }
    }

    func stop() {
        guard canStop else { return }
        stopRequested = true
        state = .stopping
        if let child { Self.stopTree(child.processIdentifier) }
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
        guard child != nil, !fromNpm else { return }
        stopRequested = true
        if let child { Self.stopTree(child.processIdentifier, wait: true) }
        runCleanup(wait: true)
    }

    /// Stop `root` and everything under it, children first. Terminating
    /// npm alone leaves its children running (measured: setup-ipad.js
    /// outlived it), and a name-pattern kill catches strangers — Max's own
    /// Node inherits npm's environment and reads like part of the stack.
    /// So the tree is walked by parent pid: SIGTERM to all, then SIGKILL to
    /// whatever is still there two seconds later.
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
            for pid in targets where kill(pid, 0) == 0 { kill(pid, SIGKILL) }
        }
        if wait {
            Thread.sleep(forTimeInterval: 2)
            reap()
        } else {
            DispatchQueue.global().asyncAfter(deadline: .now() + 2, execute: reap)
        }
    }

    nonisolated static func childPids(of pid: pid_t) -> [pid_t] {
        let count = proc_listchildpids(pid, nil, 0)
        guard count > 0 else { return [] }
        var pids = [pid_t](repeating: 0, count: Int(count) * 2)
        let filled = proc_listchildpids(pid, &pids, Int32(pids.count * MemoryLayout<pid_t>.size))
        guard filled > 0 else { return [] }
        return Array(pids.prefix(Int(filled))).filter { $0 > 0 }
    }

    private func childExited(_ code: Int32) {
        child = nil
        appendToLog("— npm run ipad exited with \(code) —")
        if stopRequested {
            state = .stopped
            return
        }
        // Not asked to stop: start it again, unless it keeps dying, which
        // restarting will not fix (a build error, a port held elsewhere).
        let now = Date()
        recentExits = recentExits.filter { now.timeIntervalSince($0) < Self.restartWindow } + [now]
        state = .failed("npm run ipad exited (\(code)); see the log")
        guard recentExits.count <= Self.restartLimit else {
            appendToLog("— not restarting: \(recentExits.count) exits in \(Int(Self.restartWindow)) s —")
            return
        }
        appendToLog("— restarting in \(Int(Self.restartDelay)) s —")
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(Self.restartDelay))
            if case .failed = self.state, self.child == nil { self.start() }
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
        if let log = openLog() {
            cleanup.standardOutput = log
            cleanup.standardError = log
        }
        cleanup.terminationHandler = { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if self.child == nil && self.state == .stopping { self.state = .stopped }
            }
        }
        try? cleanup.run()
        if wait { cleanup.waitUntilExit() }
    }

    // MARK: - Health

    private func checkHealth() async {
        let up = await pageAnswers()
        pageUp = up
        switch state {
        case .stopped, .failed:
            if up && child == nil { state = .external }
        case .external:
            if !up { state = .stopped }
        case .starting:
            if up {
                state = .running
            } else if let since = starting, Date().timeIntervalSince(since) > Self.startLimit {
                state = .failed("the page server never answered; see the log")
            }
        case .running, .stopping, .updating:
            break
        }
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

    // MARK: - Log

    /// Opened for appending: this app and the child each hold the file, and
    /// without O_APPEND each writes at its own offset, over the other's lines.
    private func openLog() -> FileHandle? {
        guard let url = logURL else { return nil }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let fd = open(url.path, O_WRONLY | O_APPEND | O_CREAT, 0o644)
        guard fd >= 0 else { return nil }
        return FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    }

    private func appendToLog(_ line: String) {
        guard let handle = openLog() else { return }
        handle.write(Data("\n[\(Date())] \(line)\n".utf8))
        try? handle.close()
    }

    func showLog() {
        guard let url = logURL else { return }
        if !FileManager.default.fileExists(atPath: url.path) { appendToLog("— log opened —") }
        NSWorkspace.shared.open(url)
    }

    func copyIPadAddress() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(iPadAddress, forType: .string)
    }
}
