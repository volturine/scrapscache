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
        bridge?.registerPluginInstance(AppIconPlugin())
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
        fillWindow()
        clearWindowControls()
        reservedRegions.publish()
    }

    /// Keeps the web view the size of its window. The status bar plugin moves it
    /// down by how much taller the status bar is than the view's top inset: meant
    /// for a doubled bar on an old iPhone, and wrong in an iPad window, where the
    /// bar is the screen's and the inset the window's, so the window's black showed
    /// in a strip above the page. The page keeps clear of the safe area itself.
    private func fillWindow() {
        guard let window = view.window, view.frame != window.bounds else { return }
        view.frame = window.bounds
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        clearWindowControls()
        reservedRegions.publish()
    }

    /// In an iPad window iOS draws the window's controls over its top leading
    /// corner and leaves them out of the safe area, which is all the page lays
    /// itself out by. The height they take is added to the safe area here, so the
    /// page starts below them. It is measured on the window, which this addition
    /// does not reach, so it goes again when the window fills the screen and its
    /// controls hide. An iPhone has no such controls; there the same measure is
    /// the screen's rounded corners, which the page already allows for.
    private func clearWindowControls() {
        guard #available(iOS 26.0, *), traitCollection.userInterfaceIdiom == .pad,
              let window = view.window else { return }
        let clear = window.edgeInsets(for: .safeArea(cornerAdaptation: .vertical)).top
        let extra = max(0, clear - window.safeAreaInsets.top)
        guard abs(additionalSafeAreaInsets.top - extra) > 0.5 else { return }
        additionalSafeAreaInsets.top = extra
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

/// Settings > App icon. `AppIcon.get()` answers whether iOS offers alternate
/// icons and which master shows (no `master` for the app's own icon);
/// `AppIcon.set({ master })` changes it, and a null master puts the app's own
/// back. Each master's alternate is named after the app's own icon set,
/// `AppIcon-<master>`, or `AppIcon-Dev-<master>` under the DEV band in the dev
/// app: the sets the App target lists in ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES.
/// iOS confirms a change with an alert of its own.
final class AppIconPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "AppIconPlugin"
    let jsName = "AppIcon"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise)
    ]

    /// "AppIcon-" or "AppIcon-Dev-": the app's own icon set, from the Info.plist
    /// the asset catalog compiler writes it into.
    private static let prefix: String = {
        let icons = Bundle.main.object(forInfoDictionaryKey: "CFBundleIcons") as? [String: Any]
        let primary = icons?["CFBundlePrimaryIcon"] as? [String: Any]
        return "\(primary?["CFBundleIconName"] as? String ?? "AppIcon")-"
    }()

    @objc func get(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let app = UIApplication.shared
            var result: [String: Any] = ["supported": app.supportsAlternateIcons]
            if let name = app.alternateIconName, name.hasPrefix(Self.prefix) {
                result["master"] = String(name.dropFirst(Self.prefix.count))
            }
            call.resolve(result)
        }
    }

    @objc func set(_ call: CAPPluginCall) {
        let name = call.getString("master").map { Self.prefix + $0 }
        DispatchQueue.main.async {
            let app = UIApplication.shared
            guard app.supportsAlternateIcons else {
                return call.reject("This device keeps the app's own icon")
            }
            app.setAlternateIconName(name) { error in
                if let error { call.reject(error.localizedDescription) } else { call.resolve() }
            }
        }
    }
}
