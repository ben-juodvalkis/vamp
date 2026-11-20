import AppKit
import WebKit

/// Vamp's own window on the Mac (ADR-520): the same interface the iPad
/// shows, from the page server Vamp for Mac starts. Opened from the Dock,
/// from the menu's "Open Vamp", or at Settings by "Settings…" (⌘,).
///
/// While it is open the app is a regular app (a Dock icon, ⌘-Tab, a menu
/// bar with Settings… and Edit); closed, it is a menu-bar agent again and
/// the page goes with the window, so a closed window is not a client of
/// the bridge.
///
/// Until the page has drawn, a progress screen covers it: a checklist of the
/// start's steps, read from the log, each with its time (the one under way
/// counting up), and a bar; or "Updating Vamp for Mac…" while it rebuilds itself.
@MainActor
final class MainWindow: NSObject, NSWindowDelegate, WKNavigationDelegate {
    static let shared = MainWindow()

    private var window: NSWindow?
    private var web: WKWebView?
    /// The page has loaded; a later Settings… sets the hash on it.
    private var loaded = false
    /// A Settings… asked for before the page loaded.
    private var wantsSettings = false

    /// The progress screen over the window until the page has drawn.
    private var progress: StartProgressView?
    private var tick: Timer?
    /// Reading the start's output from the log: where it got to, and a line
    /// cut off at the end of the last read.
    private var logOffset: UInt64?
    private var partialLine = ""
    private var step: StartStep = .preparing
    private var stepSince = Date()
    /// How long each finished step took, by the window's own clock.
    private var took: [StartStep: Double] = [:]
    private var buildSkipped = false
    private var probing = false

    /// The page's own background (app.html's theme-color), so nothing flashes.
    static let pageBackground = StartProgressView.background
    /// The recent builds' times, for the bar's pace next time.
    private static let buildsKey = "recentInterfaceBuildSeconds"
    /// The one build time kept before 2026-11-20, read until a build replaces it.
    private static let oldBuildKey = "lastInterfaceBuildSeconds"
    private var recentBuilds: [Double] {
        if let list = UserDefaults.standard.array(forKey: Self.buildsKey) as? [Double] { return list }
        let old = UserDefaults.standard.double(forKey: Self.oldBuildKey)
        return old > 0 ? [old] : []
    }

    var isOpen: Bool { window?.isVisible == true }

    /// Bring the window up; `settings` opens the interface's Settings.
    func show(settings: Bool = false) {
        if settings { wantsSettings = true }
        let window = self.window ?? makeWindow()
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        if web == nil { loadWhenUp() } else if loaded, wantsSettings { openSettings() }
    }

    private func makeWindow() -> NSWindow {
        // The iPad's own size, which the layout is drawn for, kept on screen.
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1366, height: 1024)
        let size = NSSize(width: min(1366, screen.width - 40), height: min(1024, screen.height - 40))
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = "Vamp"
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 360, height: 480)
        window.backgroundColor = Self.pageBackground
        window.delegate = self
        window.center()
        window.setFrameAutosaveName("VampMainWindow")
        self.window = window
        return window
    }

    /// Show the progress screen, and load the page once the page server answers.
    private func loadWhenUp() {
        guard let vamp = Supervisor.current, let content = window?.contentView else { return }
        if progress == nil {
            let view = StartProgressView(frame: content.bounds)
            view.autoresizingMask = [.width, .height]
            content.addSubview(view)
            progress = view
        }
        progress?.alphaValue = 1
        // Read the start's output from where this app started it; a start
        // made elsewhere (a Terminal, a crash ago) shows no steps.
        logOffset = vamp.startLogOffset
        partialLine = ""
        step = vamp.startLogOffset == nil && vamp.pageUp ? .loading : .preparing
        stepSince = Date()
        took = [:]
        buildSkipped = false
        tick?.invalidate()
        tick = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.update() }
        }
        update()
    }

    private func update() {
        guard let vamp = Supervisor.current else { return }
        readLog()
        if web == nil {
            if vamp.pageUp {
                move(to: .loading)
                load(port: vamp.pagePort)
            } else if step >= .startingServers, !probing {
                // Listening, or about to: ask now rather than at the next health tick.
                probing = true
                Task { @MainActor in
                    await vamp.refreshHealth()
                    self.probing = false
                }
            }
        }
        progress?.show(display(vamp))
    }

    /// What the progress screen says for the supervisor's state and the step.
    private func display(_ vamp: Supervisor, finished: Bool = false) -> StartProgressView.Display {
        let buildEstimate = SupervisorRules.buildEstimate(recent: recentBuilds)
        let inStep = Date().timeIntervalSince(stepSince)
        let fraction = finished ? 1 : SupervisorRules.startFraction(step, secondsInStep: inStep, buildEstimate: buildEstimate)
        let readsSteps = logOffset != nil || step >= .loading
        func rows(failed: Bool) -> [StartRow] {
            guard readsSteps else { return [] }
            return SupervisorRules.startRows(at: step, secondsInStep: inStep, took: took,
                                             buildSkipped: buildSkipped, failed: failed, finished: finished)
        }
        switch vamp.state {
        case .updating:
            return .init(label: "Updating Vamp for Mac…", detail: "Vamp for Mac's code changed: rebuilding it, then it reopens", fraction: nil)
        case .failed(let why):
            let reason = why.replacingOccurrences(of: "; see the log", with: "")
            return .init(label: "Vamp didn't start", detail: "\(reason.prefix(1).uppercased() + reason.dropFirst()). Vamp's menu bar icon opens the log.",
                         fraction: nil, rows: rows(failed: true), failed: true)
        case .stopped, .stopping:
            return .init(label: vamp.statusLine, detail: "Start Vamp from the menu bar", fraction: nil)
        case .external where web == nil:
            return .init(label: "Waiting for the page server…", detail: vamp.statusLine, fraction: nil)
        default:
            guard readsSteps else {
                return .init(label: "Waiting for the page server…", detail: nil, fraction: nil)
            }
            let detail = step == .building && !finished
                ? "Only after an update · up to \(Int(buildEstimate.rounded())) s lately"
                : nil
            return .init(label: "", detail: detail, fraction: fraction, rows: rows(failed: false))
        }
    }

    private func move(to next: StartStep) {
        guard next > step else { return }
        took[step] = Date().timeIntervalSince(stepSince)
        step = next
        stepSince = Date()
    }

    /// Read what the child wrote since the last look, for its step markers.
    private func readLog() {
        guard let offset = logOffset, let url = VampLog.url,
              let handle = try? FileHandle(forReadingFrom: url) else { return }
        defer { try? handle.close() }
        guard (try? handle.seek(toOffset: offset)) != nil, let data = try? handle.readToEnd(), !data.isEmpty else { return }
        logOffset = offset + UInt64(data.count)
        let text = partialLine + String(decoding: data, as: UTF8.self)
        var lines = text.components(separatedBy: "\n")
        partialLine = lines.removeLast()
        for line in lines {
            if SupervisorRules.buildSkipped(in: line) { buildSkipped = true }
            if let next = SupervisorRules.startStep(after: line) { move(to: next) }
            if let seconds = SupervisorRules.buildSeconds(in: line) {
                UserDefaults.standard.set(SupervisorRules.recentBuilds(recentBuilds, adding: seconds), forKey: Self.buildsKey)
            }
        }
    }

    private func load(port: UInt16) {
        guard let content = window?.contentView else { return }
        let web = WKWebView(frame: content.bounds, configuration: WKWebViewConfiguration())
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) { web.isInspectable = true }
        // Under the progress screen, which leaves once the page has drawn.
        if let progress { content.addSubview(web, positioned: .below, relativeTo: progress) } else { content.addSubview(web) }
        self.web = web
        loaded = false
        let hash = wantsSettings ? "#settings" : ""
        wantsSettings = false
        web.load(URLRequest(url: URL(string: "http://localhost:\(port)/\(hash)")!))
        VampLog.line("Vamp window: loading the interface on :\(port)\(hash)")
    }

    private func openSettings() {
        wantsSettings = false
        // The interface opens Settings on `#settings` and clears it again.
        web?.evaluateJavaScript("location.hash = 'settings'", completionHandler: nil)
    }

    /// The load event comes before SvelteKit has drawn anything: wait (up to
    /// 3 s) for its body to have content, then fade the progress screen out.
    private func revealWhenDrawn(tries: Int = 0) {
        guard let web, progress != nil else { return }
        let js = "(() => { const b = document.querySelector('body > div'); return !!b && b.childElementCount > 0 })()"
        web.evaluateJavaScript(js) { [weak self] result, _ in
            Task { @MainActor in
                guard let self else { return }
                if (result as? Bool) == true || tries >= 30 {
                    self.hideProgress()
                } else {
                    try? await Task.sleep(for: .milliseconds(100))
                    self.revealWhenDrawn(tries: tries + 1)
                }
            }
        }
    }

    private func hideProgress() {
        tick?.invalidate()
        tick = nil
        guard let view = progress else { return }
        progress = nil
        if let vamp = Supervisor.current {
            took[step] = Date().timeIntervalSince(stepSince)
            view.show(display(vamp, finished: true))
        }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.35
            view.animator().alphaValue = 0
        }, completionHandler: { view.removeFromSuperview() })
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        if wantsSettings { openSettings() }
        revealWhenDrawn()
    }

    /// The page server went away between the health check and the load
    /// (a restart): wait for it again.
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        VampLog.line("Vamp window: the page did not load (\(error.localizedDescription)); waiting for the page server")
        tearDownPage()
        if isOpen { loadWhenUp() }
    }

    // MARK: - NSWindowDelegate

    func windowWillClose(_ notification: Notification) {
        tearDownPage()
        NSApp.setActivationPolicy(.accessory)
    }

    private func tearDownPage() {
        tick?.invalidate()
        tick = nil
        progress?.removeFromSuperview()
        progress = nil
        web?.removeFromSuperview()
        web = nil
        loaded = false
    }
}

/// The Vamp window's progress screen while Vamp starts: the app icon, its
/// name, a checklist of the start's steps (done ones ticked with the time
/// they took, the one under way spinning and counting up), the bar, and a
/// note, on the page's own background.
final class StartProgressView: NSView {
    struct Display: Equatable {
        /// Under the name; empty during a start, which the checklist tells.
        var label: String
        var detail: String?
        /// nil: indeterminate (no steps to read, or an update).
        var fraction: Double?
        /// The checklist; empty when there are no steps to show.
        var rows: [StartRow] = []
        var failed = false
    }

    /// The page's own background (app.html's theme-color), so nothing flashes.
    static let background = NSColor(srgbRed: 0x1f / 255.0, green: 0x21 / 255.0, blue: 0x26 / 255.0, alpha: 1)

    private let icon = NSImageView()
    private let title = NSTextField(labelWithString: "Vamp")
    private let label = NSTextField(labelWithString: "")
    private let list = NSStackView()
    private var rowViews: [StartRowView] = []
    private let bar = NSProgressIndicator()
    private let detail = NSTextField(wrappingLabelWithString: "")
    private var stack = NSStackView()
    private var shown: Display?

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = Self.background.cgColor
        appearance = NSAppearance(named: .darkAqua)

        icon.image = NSApp.applicationIconImage
        icon.imageScaling = .scaleProportionallyUpOrDown
        title.font = .systemFont(ofSize: 28, weight: .semibold)
        title.textColor = .white
        label.font = .systemFont(ofSize: 15, weight: .medium)
        label.textColor = NSColor.white.withAlphaComponent(0.85)
        detail.font = .systemFont(ofSize: 12)
        detail.textColor = NSColor.white.withAlphaComponent(0.5)
        for field in [title, label, detail] {
            field.alignment = .center
            field.lineBreakMode = .byTruncatingTail
        }
        label.setContentCompressionResistancePriority(.required, for: .horizontal)
        detail.maximumNumberOfLines = 3
        detail.lineBreakMode = .byWordWrapping
        detail.preferredMaxLayoutWidth = 340

        list.orientation = .vertical
        list.alignment = .leading
        list.spacing = 10
        for _ in StartStep.all {
            let row = StartRowView()
            rowViews.append(row)
            list.addArrangedSubview(row)
            row.widthAnchor.constraint(equalToConstant: 300).isActive = true
        }

        bar.style = .bar
        bar.minValue = 0
        bar.maxValue = 1
        bar.controlSize = .small

        stack = NSStackView(views: [icon, title, label, list, bar, detail])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 10
        stack.setCustomSpacing(16, after: icon)
        stack.setCustomSpacing(4, after: title)
        stack.setCustomSpacing(22, after: label)
        stack.setCustomSpacing(22, after: list)
        stack.setCustomSpacing(12, after: bar)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            icon.widthAnchor.constraint(equalToConstant: 88),
            icon.heightAnchor.constraint(equalToConstant: 88),
            bar.widthAnchor.constraint(equalToConstant: 300),
            detail.widthAnchor.constraint(equalToConstant: 340),
            label.widthAnchor.constraint(lessThanOrEqualToConstant: 420),
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -20),
        ])
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    /// Clicks stay off the page underneath until the screen has gone.
    override func hitTest(_ point: NSPoint) -> NSView? { alphaValue > 0 ? self : nil }

    func show(_ display: Display) {
        guard display != shown else { return }
        let was = shown
        shown = display
        label.stringValue = display.label
        label.isHidden = display.label.isEmpty
        stack.setCustomSpacing(label.isHidden ? 22 : 4, after: title)
        label.textColor = display.failed ? .systemOrange : NSColor.white.withAlphaComponent(0.85)
        detail.stringValue = display.detail ?? ""
        detail.isHidden = display.detail == nil
        list.isHidden = display.rows.isEmpty
        for (view, row) in zip(rowViews, display.rows) { view.show(row) }
        bar.isHidden = display.failed
        if let fraction = display.fraction {
            if bar.isIndeterminate { bar.stopAnimation(nil); bar.isIndeterminate = false }
            bar.doubleValue = fraction
        } else if !bar.isIndeterminate || was == nil {
            bar.isIndeterminate = true
            bar.startAnimation(nil)
        }
    }
}

/// One checklist line: a tick, a spinner, an empty ring or a cross; the
/// step's name; and its time on the right.
final class StartRowView: NSView {
    private let mark = NSImageView()
    private let spinner = NSProgressIndicator()
    private let name = NSTextField(labelWithString: "")
    private let time = NSTextField(labelWithString: "")
    private var shown: StartRow?

    init() {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isDisplayedWhenStopped = false
        name.font = .systemFont(ofSize: 14)
        name.lineBreakMode = .byTruncatingTail
        time.font = .monospacedDigitSystemFont(ofSize: 13, weight: .regular)
        time.alignment = .right
        for view in [mark, spinner, name, time] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 20),
            mark.leadingAnchor.constraint(equalTo: leadingAnchor),
            mark.centerYAnchor.constraint(equalTo: centerYAnchor),
            mark.widthAnchor.constraint(equalToConstant: 18),
            mark.heightAnchor.constraint(equalToConstant: 18),
            spinner.centerXAnchor.constraint(equalTo: mark.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: mark.centerYAnchor),
            name.leadingAnchor.constraint(equalTo: mark.trailingAnchor, constant: 12),
            name.centerYAnchor.constraint(equalTo: centerYAnchor),
            name.trailingAnchor.constraint(lessThanOrEqualTo: time.leadingAnchor, constant: -8),
            time.trailingAnchor.constraint(equalTo: trailingAnchor),
            time.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    func show(_ row: StartRow) {
        guard row != shown else { return }
        shown = row
        name.stringValue = row.title
        time.stringValue = row.seconds.map { $0 < 1 ? "<1 s" : "\($0) s" } ?? ""
        let white = NSColor.white
        let symbol: (String, NSColor)?
        switch row.state {
        case .done, .skipped:
            symbol = ("checkmark.circle.fill", .systemGreen)
            name.textColor = white.withAlphaComponent(0.75)
            time.textColor = white.withAlphaComponent(0.4)
        case .active:
            symbol = nil
            name.textColor = white
            time.textColor = white.withAlphaComponent(0.75)
        case .pending:
            symbol = ("circle", white.withAlphaComponent(0.25))
            name.textColor = white.withAlphaComponent(0.35)
            time.textColor = white.withAlphaComponent(0.35)
        case .failed:
            symbol = ("xmark.circle.fill", .systemOrange)
            name.textColor = .systemOrange
            time.textColor = NSColor.systemOrange.withAlphaComponent(0.75)
        }
        if let (name, color) = symbol {
            let config = NSImage.SymbolConfiguration(pointSize: 15, weight: .regular)
            mark.image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(config)
            mark.contentTintColor = color
            mark.isHidden = false
            spinner.stopAnimation(nil)
        } else {
            mark.isHidden = true
            spinner.startAnimation(nil)
        }
    }
}
