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
    private var probing = false

    /// The page's own background (app.html's theme-color), so nothing flashes.
    static let pageBackground = NSColor(srgbRed: 0x1f / 255.0, green: 0x21 / 255.0, blue: 0x26 / 255.0, alpha: 1)
    /// The last build's time, for the bar's pace next time.
    private static let buildKey = "lastInterfaceBuildSeconds"

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
    private func display(_ vamp: Supervisor) -> StartProgressView.Display {
        let estimate = UserDefaults.standard.double(forKey: Self.buildKey)
        let buildEstimate = estimate > 0 ? estimate : 10
        let fraction = SupervisorRules.startFraction(step, secondsInStep: Date().timeIntervalSince(stepSince),
                                                    buildEstimate: buildEstimate)
        switch vamp.state {
        case .updating:
            return .init(label: "Updating Vamp for Mac…", detail: "Vamp for Mac's code changed: rebuilding it, then it reopens", fraction: nil)
        case .failed(let why):
            return .init(label: "Vamp didn't start", detail: "\(why). Vamp's menu bar icon opens the log.".replacingOccurrences(of: "; see the log", with: ""), fraction: nil, failed: true)
        case .stopped, .stopping:
            return .init(label: vamp.statusLine, detail: "Start Vamp from the menu bar", fraction: nil)
        case .external where web == nil:
            return .init(label: "Waiting for the page server…", detail: vamp.statusLine, fraction: nil)
        default:
            if logOffset == nil && step < .loading {
                return .init(label: "Waiting for the page server…", detail: nil, fraction: nil)
            }
            let detail = step == .building
                ? "About \(Int(buildEstimate.rounded())) s · only when the interface's code has changed"
                : nil
            return .init(label: step.label, detail: detail, fraction: fraction)
        }
    }

    private func move(to next: StartStep) {
        guard next > step else { return }
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
            if let next = SupervisorRules.startStep(after: line) { move(to: next) }
            if let seconds = SupervisorRules.buildSeconds(in: line) {
                UserDefaults.standard.set(seconds, forKey: Self.buildKey)
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
        view.show(.init(label: "Loading the interface…", detail: nil, fraction: 1))
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.25
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

/// The Vamp window's progress screen while Vamp starts: the app
/// icon, its name, the step and a bar, on the page's own background.
final class StartProgressView: NSView {
    struct Display: Equatable {
        var label: String
        var detail: String?
        /// nil: indeterminate (no steps to read, or an update).
        var fraction: Double?
        var failed = false
    }

    private let icon = NSImageView()
    private let title = NSTextField(labelWithString: "Vamp")
    private let label = NSTextField(labelWithString: "")
    private let detail = NSTextField(wrappingLabelWithString: "")
    private let bar = NSProgressIndicator()
    private var shown: Display?

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = MainWindow.pageBackground.cgColor
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
        detail.maximumNumberOfLines = 3
        detail.lineBreakMode = .byWordWrapping
        detail.preferredMaxLayoutWidth = 360
        bar.style = .bar
        bar.minValue = 0
        bar.maxValue = 1
        bar.controlSize = .regular

        let stack = NSStackView(views: [icon, title, label, bar, detail])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 10
        stack.setCustomSpacing(18, after: icon)
        stack.setCustomSpacing(14, after: label)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            icon.widthAnchor.constraint(equalToConstant: 96),
            icon.heightAnchor.constraint(equalToConstant: 96),
            bar.widthAnchor.constraint(equalToConstant: 280),
            detail.widthAnchor.constraint(equalToConstant: 360),
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
        label.textColor = display.failed ? .systemOrange : NSColor.white.withAlphaComponent(0.85)
        detail.stringValue = display.detail ?? ""
        detail.isHidden = display.detail == nil
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
