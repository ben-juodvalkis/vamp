import SwiftUI
import UIKit
import WebKit

/// Vamp for iPad: Vamp's own interface, full screen, reached over the USB
/// cable through Vamp for Mac rather than over a network.
///
/// The interface is not in the app. The web view loads it from
/// `localhost:pagePort`, where `LinkServer` hands each connection to the Mac
/// over usbmux and the Mac splices it to the page server Safari uses. So an
/// interface change needs `npm run ipad` and a reload, never a new app.
@main
struct VampPadApp: App {
    @StateObject private var model = PadModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            PadRoot(model: model)
                .ignoresSafeArea()
                .statusBarHidden()
                .persistentSystemOverlays(.hidden)
                .preferredColorScheme(.dark)
        }
        .onChange(of: scenePhase) { _, phase in
            model.scenePhaseChanged(phase)
        }
    }
}

/// The ports, copied from `padLink` in config/constants.json (the app
/// cannot read it). `padLinkPorts.test.ts` keeps the copies equal.
enum PadPorts {
    static let device: UInt16 = 47800
    static let page: UInt16 = 8889

    /// Where the web view loads from inside the app. The same as `page` on
    /// an iPad. The Simulator shares the Mac's own loopback, where the Mac's
    /// page server already holds `page` — so there, launch with
    /// `-padLocalPagePort <port>` to move the app's listener aside.
    static var localPage: UInt16 {
        let override = UserDefaults.standard.integer(forKey: "padLocalPagePort")
        return override > 0 ? UInt16(override) : page
    }
}

@MainActor
final class PadModel: ObservableObject {
    /// Vamp for Mac is on the other end of the cable.
    @Published private(set) var linked = false
    /// The interface has loaded at least once since the app started.
    @Published var pageLoaded = false
    /// Bumped to make the web view load the page again.
    @Published private(set) var reloadToken = 0

    private let server = LinkServer(devicePort: PadPorts.device, pagePort: PadPorts.localPage)

    init() {
        server.onLinkChange = { [weak self] up in
            Task { @MainActor in self?.linkChanged(up) }
        }
        server.start()
        // A performance surface: the iPad must not dim or lock mid-set.
        UIApplication.shared.isIdleTimerDisabled = true
    }

    var pageURL: URL { URL(string: "http://localhost:\(PadPorts.localPage)/")! }

    private func linkChanged(_ up: Bool) {
        linked = up
        // A loaded page reconnects by itself (its socket retries every
        // second); only a page that never loaded needs loading again.
        if up && !pageLoaded { reloadToken += 1 }
    }

    func pageFailed() {
        pageLoaded = false
        guard linked else { return }
        Task {
            try? await Task.sleep(for: .seconds(1))
            if self.linked && !self.pageLoaded { self.reloadToken += 1 }
        }
    }

    func scenePhaseChanged(_ phase: ScenePhase) {
        if phase == .active {
            server.restartIfNeeded()
            UIApplication.shared.isIdleTimerDisabled = true
        }
    }
}

struct PadRoot: View {
    @ObservedObject var model: PadModel

    var body: some View {
        ZStack {
            Color.black
            PadWebView(model: model)
                .opacity(model.pageLoaded ? 1 : 0)
            if !model.pageLoaded {
                WaitingView(linked: model.linked)
            } else if !model.linked {
                VStack {
                    Spacer()
                    Text("Reconnecting to the Mac…")
                        .font(.callout.weight(.medium))
                        .padding(.horizontal, 16).padding(.vertical, 8)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(.bottom, 24)
                }
                .allowsHitTesting(false)
            }
        }
    }
}

struct WaitingView: View {
    let linked: Bool

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: linked ? "hourglass" : "cable.connector")
                .font(.system(size: 56, weight: .light))
            Text(linked ? "Loading Vamp…" : "Waiting for the Mac")
                .font(.title2.weight(.semibold))
            if !linked {
                Text("Plug the iPad into the Mac with a USB cable, and start Vamp there.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 420)
            }
        }
        .foregroundStyle(.white)
    }
}

struct PadWebView: UIViewRepresentable {
    @ObservedObject var model: PadModel

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // Tells the page it fills the screen with no status bar or home
        // indicator, before its first paint: app.css then gives it top and
        // bottom margins the safe-area inset no longer supplies.
        config.userContentController.addUserScript(WKUserScript(
            source: "document.documentElement.dataset.shell = 'pad';",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true))
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        // Safari's Web Inspector on the Mac can attach, as it can to a page.
        webView.isInspectable = true
        context.coordinator.lastToken = model.reloadToken
        webView.load(URLRequest(url: model.pageURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if context.coordinator.lastToken != model.reloadToken {
            context.coordinator.lastToken = model.reloadToken
            webView.load(URLRequest(url: model.pageURL))
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        let model: PadModel
        var lastToken = 0

        init(model: PadModel) { self.model = model }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            Task { @MainActor in self.model.pageLoaded = true }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            Task { @MainActor in self.model.pageFailed() }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            Task { @MainActor in self.model.pageFailed() }
        }

        /// iPadOS can kill the page's process under memory pressure; load
        /// it again rather than leave a blank screen.
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            Task { @MainActor in self.model.pageFailed() }
        }
    }
}
