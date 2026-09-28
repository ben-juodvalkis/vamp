import SwiftUI
import AppKit

@main
struct LoopingMenuBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var state = AppState()

    var body: some Scene {
        MenuBarExtra {
            MenuContent(state: state)
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
}

/// The dropdown. Native `.menu` style renders `Toggle` rows as checkmark items.
struct MenuContent: View {
    @ObservedObject var state: AppState

    var body: some View {
        Text(statusLine)

        Divider()

        // Primary SessionSettings toggles.
        settingToggle(.autoArm)
        settingToggle(.moveVolumeKnob)
        settingToggle(.autoCapture)

        Divider()

        Text("Transport")
        settingToggle(.metronome)

        Divider()

        Button("Quit") { NSApp.terminate(nil) }
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
