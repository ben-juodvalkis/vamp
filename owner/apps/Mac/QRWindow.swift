import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins

/// A small window with a QR code and a line under it: the iPad's address
/// for Safari (`Supervisor.showQRCode`), and a pairing code for Vamp for
/// iPad (`PadLink.showPairingQR`, ADR-505).
enum QRWindow {
    /// Vamp for iPad's page on the App Store, for someone who has not got
    /// it yet: the Mac opens it, and it can be shared from there.
    static let appStoreURL = URL(string: "https://apps.apple.com/app/id6829034226")!

    static func make(message: String, title: String, caption: String, button: (title: String, action: () -> Void)? = nil) -> NSPanel? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(message.utf8)
        filter.correctionLevel = "M"
        guard let code = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)) else { return nil }
        let rep = NSCIImageRep(ciImage: code)
        let image = NSImage(size: rep.size)
        image.addRepresentation(rep)
        let side: CGFloat = 280
        let buttonRow: CGFloat = button == nil ? 0 : 36
        let captionHeight: CGFloat = 36
        let view = NSImageView(frame: NSRect(x: 20, y: 14 + buttonRow + captionHeight + 8, width: side, height: side))
        view.image = image
        view.imageScaling = .scaleProportionallyUpOrDown
        let label = NSTextField(wrappingLabelWithString: caption)
        label.frame = NSRect(x: 20, y: 14 + buttonRow, width: side, height: captionHeight)
        label.alignment = .center
        let window = NSPanel(contentRect: NSRect(x: 0, y: 0, width: side + 40, height: side + captionHeight + buttonRow + 36),
                             styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = title
        window.contentView?.addSubview(view)
        window.contentView?.addSubview(label)
        if let button {
            let target = ButtonTarget(button.action)
            let control = NSButton(title: button.title, target: target, action: #selector(ButtonTarget.fire))
            control.frame = NSRect(x: 20, y: 10, width: side, height: 28)
            window.contentView?.addSubview(control)
            objc_setAssociatedObject(control, &ButtonTarget.key, target, .OBJC_ASSOCIATION_RETAIN)
        }
        window.isReleasedWhenClosed = false
        window.center()
        return window
    }

    static func show(_ window: NSPanel) {
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    private final class ButtonTarget: NSObject {
        nonisolated(unsafe) static var key = 0
        let action: () -> Void
        init(_ action: @escaping () -> Void) { self.action = action }
        @objc func fire() { action() }
    }
}
