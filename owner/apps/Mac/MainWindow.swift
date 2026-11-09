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
    private var placeholder: NSTextField?
    /// The page has loaded; a later Settings… sets the hash on it.
    private var loaded = false
    private var waitTimer: Timer?
    /// A Settings… asked for before the page loaded.
    private var wantsSettings = false

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
        window.backgroundColor = .black
        window.delegate = self
        window.center()
        window.setFrameAutosaveName("VampMainWindow")
        self.window = window
        return window
    }

    /// Load the page once the page server answers; until then say why it is blank.
    private func loadWhenUp() {
        guard let vamp = Supervisor.current else { return }
        if vamp.pageUp {
            load(port: vamp.pagePort)
            return
        }
        showPlaceholder(vamp.statusLine)
        waitTimer?.invalidate()
        waitTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let vamp = Supervisor.current else { return }
                if vamp.pageUp {
                    self.waitTimer?.invalidate()
                    self.waitTimer = nil
                    self.load(port: vamp.pagePort)
                } else {
                    self.placeholder?.stringValue = vamp.statusLine
                }
            }
        }
    }

    private func load(port: UInt16) {
        guard let content = window?.contentView else { return }
        placeholder?.removeFromSuperview()
        placeholder = nil
        let web = WKWebView(frame: content.bounds, configuration: WKWebViewConfiguration())
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) { web.isInspectable = true }
        content.addSubview(web)
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

    private func showPlaceholder(_ text: String) {
        guard let content = window?.contentView else { return }
        let label = placeholder ?? NSTextField(labelWithString: "")
        label.stringValue = text
        label.textColor = .secondaryLabelColor
        label.font = .systemFont(ofSize: 15)
        label.alignment = .center
        label.frame = NSRect(x: 0, y: content.bounds.midY - 12, width: content.bounds.width, height: 24)
        label.autoresizingMask = [.width, .minYMargin, .maxYMargin]
        if label.superview == nil { content.addSubview(label) }
        placeholder = label
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        if wantsSettings { openSettings() }
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
        waitTimer?.invalidate()
        waitTimer = nil
        web?.removeFromSuperview()
        web = nil
        loaded = false
    }
}
