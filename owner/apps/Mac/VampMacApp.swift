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
    @StateObject private var pad = PadLink(config: AppConfig.load())
    @StateObject private var vamp = Supervisor(config: AppConfig.load())

    var body: some Scene {
        MenuBarExtra {
            MenuContent(state: state, pad: pad, vamp: vamp)
        } label: {
            // Filled icon when the bridge is up, hollow when it's down.
            Image(systemName: state.connected ? "repeat.circle.fill" : "repeat.circle")
        }
        .menuBarExtraStyle(.menu)
    }
}

/// Removes the Dock icon so this runs as a pure menu-bar agent — no Info.plist
/// / LSUIElement needed, which keeps `swift run` working as a real agent app.
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
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

    var body: some View {
        Text(vamp.statusLine)
        if !vamp.fromNpm {
            Button("Start Vamp") { vamp.start() }.disabled(!vamp.canStart)
            Button("Restart Vamp") { vamp.restart() }.disabled(!vamp.canStop)
            Button("Stop Vamp") { vamp.stop() }.disabled(!vamp.canStop)
        }
        Button("Copy iPad Address (\(vamp.iPadAddress))") { vamp.copyIPadAddress() }
        Button("Show Log") { vamp.showLog() }.disabled(vamp.logURL == nil)
        Toggle("Open at Login", isOn: Binding(
            get: { openAtLogin },
            set: { on in
                do {
                    if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
                } catch {}
                openAtLogin = SMAppService.mainApp.status == .enabled
            }
        ))

        Divider()

        Text(statusLine)
        Text(pad.statusLine)

        Divider()

        // Primary SessionSettings toggles.
        settingToggle(.autoArm)
        settingToggle(.moveVolumeKnob)
        settingToggle(.autoCapture)

        Divider()

        Text("Transport")
        settingToggle(.metronome)

        Divider()

        Button(vamp.fromNpm || vamp.state == .external ? "Quit" : "Quit (stops Vamp)") { NSApp.terminate(nil) }
            .keyboardShortcut("q")
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
