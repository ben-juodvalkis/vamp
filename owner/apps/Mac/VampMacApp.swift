import SwiftUI
import AppKit
import ServiceManagement

/// Vamp for Mac: the menu-bar host. Mirrors the session toggles (the menu
/// that was the Looping menu-bar app) and carries Vamp for iPad's link over
/// the USB cable (`PadLink`).
@main
struct VampMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var state = AppState()
    @StateObject private var pad = PadLink(config: AppConfig.shared)
    @StateObject private var vamp = Supervisor(config: AppConfig.shared)

    var body: some Scene {
        MenuBarExtra {
            MenuContent(state: state, pad: pad, vamp: vamp)
        } label: {
            if let code = pad.pairingCode {
                // An iPad waits for its pairing code: show it in the menu
                // bar itself, spaced in threes as the iPad's field reads.
                HStack(spacing: 4) {
                    Image(systemName: "key.fill")
                    Text("\(code.prefix(3)) \(code.suffix(3))").monospacedDigit()
                }
            } else {
                // A V for Vamp (Ben, 2026-10-31): filled when the bridge
                // is up, hollow when it's down.
                Image(systemName: state.connected ? "v.circle.fill" : "v.circle")
            }
        }
        .menuBarExtraStyle(.menu)
    }
}

/// The app's lifecycle hooks. (No Dock icon: `LSUIElement` in Info.plist.)
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var sigterm: DispatchSourceSignal?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // A `kill` or a logout's SIGTERM quits as the menu's Quit does, so
        // the Vamp this app started is stopped rather than left running.
        signal(SIGTERM, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        source.setEventHandler { NSApp.terminate(nil) }
        source.resume()
        sigterm = source
    }

    /// Quitting stops what this app started (never a Terminal's servers).
    func applicationWillTerminate(_ notification: Notification) {
        MainActor.assumeIsolated { Supervisor.current?.stopForQuit() }
    }
}

/// The dropdown. Native `.menu` style renders `Toggle` rows as checkmark items.
struct MenuContent: View {
    @ObservedObject var state: AppState
    @ObservedObject var pad: PadLink
    @ObservedObject var vamp: Supervisor
    @State private var openAtLogin = SMAppService.mainApp.status == .enabled
    @State private var loginError: String?

    var body: some View {
        Text(vamp.statusLine)
        if let note = vamp.updateNote { Text(note) }
        if let note = vamp.liveNote { Text(note) }
        if vamp.paths?.installed == true && !(state.autoArm != nil && vamp.checklist.place && vamp.checklist.iPad) {
            // Ticks itself as each is done (`SetupChecklist`).
            Text(checkLine(state.autoArm != nil, "Vamp is a Control Surface in Live"))
            Text(checkLine(vamp.checklist.place, "Live can reach Vamp Devices"))
            Text(checkLine(vamp.checklist.iPad, "An iPad is paired"))
        }
        if !vamp.fromNpm {
            Button("Start Vamp") { vamp.start() }.disabled(!vamp.canStart)
            Button("Restart Vamp") { vamp.restart() }.disabled(!vamp.canStop)
            Button("Stop Vamp") { vamp.stop() }.disabled(!vamp.canStop)
        }
        Button("Copy iPad Address (\(vamp.iPadAddress))") { vamp.copyIPadAddress() }
        Button("Show iPad Address as QR Code") { vamp.showQRCode() }
        Button("Show Log") { vamp.showLog() }.disabled(vamp.logURL == nil)
        Toggle("Open at Login", isOn: Binding(
            get: { openAtLogin },
            set: { on in
                do {
                    if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
                    loginError = nil
                } catch {
                    loginError = "Open at Login failed: \(error.localizedDescription)"
                }
                openAtLogin = SMAppService.mainApp.status == .enabled
            }
        ))
        if let loginError { Text(loginError) }

        Divider()

        Text(statusLine)
        Text(pad.statusLine)
        if let code = pad.pairingCode {
            // Spaced in threes, as the iPad's field shows it.
            Text("Pair Vamp for iPad: type \(code.prefix(3)) \(code.suffix(3)) on the iPad")
        }
        Button("Pair an iPad or iPhone with a QR Code…") { pad.showPairingQR() }
        Button("Get Vamp for iPad on the App Store…") { NSWorkspace.shared.open(QRWindow.appStoreURL) }
        Button("Forget Paired iPads") { pad.forgetPairedIPads() }

        Divider()

        // Primary SessionSettings toggles.
        settingToggle(.autoArm)
        settingToggle(.moveVolumeKnob)
        settingToggle(.autoCapture)

        Divider()

        Text("Transport")
        settingToggle(.metronome)

        Divider()

        if vamp.paths?.installed == true {
            Button("Check for Updates…") { vamp.checkForUpdates() }.disabled(vamp.updater == nil)
            Button("Uninstall Vamp…") { vamp.uninstall() }
        }
        Button(vamp.fromNpm || vamp.state == .external ? "Quit" : "Quit (stops Vamp)") { NSApp.terminate(nil) }
            .keyboardShortcut("q")
    }

    private func checkLine(_ done: Bool, _ text: String) -> String {
        "\(done ? "✓" : "○") \(text)"
    }

    /// "Bridge connected · ipad" when the mode beacon has landed, otherwise
    /// just connected/disconnected.
    private var statusLine: String {
        guard state.connected else { return "Bridge disconnected — reconnecting…" }
        if let mode = state.serverMode {
            return "Bridge connected · \(mode)"
        }
        return "Bridge connected"
    }

    /// A checkmark menu row bound to a setting. Disabled while disconnected.
    @ViewBuilder
    private func settingToggle(_ setting: Setting) -> some View {
        Toggle(setting.label, isOn: Binding(
            get: { state.value(for: setting) ?? false },
            set: { newValue in state.set(setting, to: newValue) }
        ))
        .disabled(!state.connected)
    }
}
