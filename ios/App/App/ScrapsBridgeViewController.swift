import Capacitor
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
        call.resolve(["regions": current()])
    }

    func publish() {
        let regions = current()
        let encoded = (try? JSONSerialization.data(withJSONObject: regions))
            .map { String(decoding: $0, as: UTF8.self) } ?? "[]"
        guard encoded != lastPublished else { return }
        lastPublished = encoded
        log.debug("occlusion regions \(encoded, privacy: .public)")
        notifyListeners("reservedRegions", data: ["regions": regions])
    }

    private func current() -> [[String: Any]] {
        guard #available(iOS 27.1, *), let view = bridge?.webView else { return [] }
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
