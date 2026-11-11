import Capacitor
import ObjectiveC
import UIKit
import os

/// The app's shell: Capacitor's bridge controller plus what the page cannot see
/// for itself. iPhone Duo keeps the camera island and the status cluster in a
/// column down one side of the screen; iOS reports them to a view as occlusion
/// regions, and the page keeps its rail clear of them.
final class ScrapsBridgeViewController: CAPBridgeViewController {
    private let reservedRegions = ReservedRegionsPlugin()

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(reservedRegions)
        Self.removeFormBar()
        // Until the page paints, the web view shows through; it keeps the launch
        // screen's colour, which is the page's own in light and in dark.
        if let launch = UIColor(named: "LaunchBackground") {
            webView?.backgroundColor = launch
            webView?.scrollView.backgroundColor = launch
        }
    }

    /// Takes away the previous, next and done bar iOS floats above the keys of a web
    /// form, which covers a dialog's buttons; this is a note app, not a form. WebKit
    /// offers no setting for it. Capacitor's Keyboard plugin does this too, but it also
    /// stops the web view observing the keyboard, which the page lays itself out by.
    private static func removeFormBar() {
        let name = ["WK", "Content", "View"].joined()
        let selector = #selector(getter: UIResponder.inputAccessoryView)
        guard let view = NSClassFromString(name),
              let method = class_getInstanceMethod(view, selector) else { return }
        let none: @convention(block) (AnyObject) -> UIView? = { _ in nil }
        method_setImplementation(method, imp_implementationWithBlock(none))
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        reservedRegions.publish()
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        reservedRegions.publish()
    }
}

/// `ReservedRegions.get()` answers with the occlusion regions of the web view, in
/// its own coordinate space (CSS pixels on the page), and a `reservedRegions`
/// event follows every change: a fold, a turn, or the island growing.
final class ReservedRegionsPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "ReservedRegionsPlugin"
    let jsName = "ReservedRegions"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise)
    ]
    private let log = Logger(subsystem: "com.scrapscache.app", category: "reserved-regions")
    private var lastPublished: String?

    @objc func get(_ call: CAPPluginCall) {
        // An iOS before 27.1 cannot read the regions; it says so, and the page
        // keeps its stylesheet's values rather than taking an empty report.
        guard let regions = current() else { return call.resolve(["supported": false]) }
        call.resolve(["supported": true, "regions": regions])
    }

    func publish() {
        guard let regions = current() else { return }
        let encoded = (try? JSONSerialization.data(withJSONObject: regions))
            .map { String(decoding: $0, as: UTF8.self) } ?? "[]"
        guard encoded != lastPublished else { return }
        lastPublished = encoded
        log.debug("occlusion regions \(encoded, privacy: .public)")
        notifyListeners("reservedRegions", data: ["regions": regions])
    }

    private func current() -> [[String: Any]]? {
        guard #available(iOS 27.1, *), let view = bridge?.webView else { return nil }
        return view.reservedRegions(kind: .occlusion).map { region in
            [
                "x": region.frame.minX,
                "y": region.frame.minY,
                "width": region.frame.width,
                "height": region.frame.height,
                "active": region.isActive
            ]
        }
    }
}
