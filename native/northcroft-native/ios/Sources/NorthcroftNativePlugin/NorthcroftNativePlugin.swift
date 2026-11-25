import Foundation
import UIKit
import Capacitor
import LocalAuthentication
import PassKit
import UserNotifications

/// The web app's way in to the iPhone-only parts (see src/native/plugin.ts for the JavaScript side):
///   office*        check-in at the office (OfficeWatcher)
///   biometry, authenticate   Face ID
///   shareInbox, readShared, clearShared   files shared in from other apps (ShareExtension)
///   setBadge       the number on the app icon
///   scanDocument   the iPhone's document scanner, giving back a PDF (DocumentScanner)
///   takeLaunchAction   a Siri, Shortcuts, app icon or widget action waiting to be done (LaunchActions)
///   updateWidget, clearWidget   what the home screen widget shows (WidgetData)
///   workday        the workday Live Activity on the lock screen and Dynamic Island (WorkdayActivity)
///   spotlightIndex, spotlightClear   projects and tasks in the iPhone's search (Spotlight)
///   calendarStatus, calendarEnable, calendarSync, calendarDisable   the Northcroft calendar (CalendarSync)
///   haptic         a small tap from the phone (Haptics)
///   liveTasks      tasks on the lock screen, delivery-app style (TaskActivity)
///   tripStart, tripStop, tripStatus   a trip to a site with distance and arrival time (SiteTrip)
///   siteWatch, siteStop, siteTake   the site visit log from arrivals and departures (SiteWatcher)
///   phoneStatus, openSettings   what the phone allows Northcroft to do (PhoneStatus)
///   callAudio      earpiece, loudspeaker and Bluetooth during a voice call (CallAudio)
///   appIcon, setAppIcon   the Home Screen icon style (alternate icons in Assets.xcassets)
///   addWalletPass  shows Apple Wallet's "Add" screen for the staff pass (PassKit)
@objc(NorthcroftNativePlugin)
public class NorthcroftNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NorthcroftNativePlugin"
    public let jsName = "NorthcroftNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "officeStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "officePermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "officeWatch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "officeStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "officeMarkCheckedIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "officePending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "biometry", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareInbox", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readShared", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearShared", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBadge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanDocument", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeLaunchAction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateWidget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearWidget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "workday", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "spotlightIndex", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "spotlightClear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "calendarStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "calendarEnable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "calendarSync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "calendarDisable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "haptic", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "liveTasks", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tripStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tripStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tripStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "siteWatch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "siteStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "siteTake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "phoneStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "callAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appIcon", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAppIcon", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addWalletPass", returnType: CAPPluginReturnPromise)
    ]

    private var launchObserver: NSObjectProtocol?

    override public func load() {
        // Also done in AppDelegate; repeating it here is harmless and covers an older AppDelegate.
        NorthcroftSetup.start()
        // A Siri, Shortcuts, app icon or widget action while the app is already open: tell the web
        // app, which then takes it with takeLaunchAction.
        launchObserver = NotificationCenter.default.addObserver(forName: LaunchActions.didChange, object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("launchAction", data: [:])
        }
    }

    deinit {
        if let o = launchObserver { NotificationCenter.default.removeObserver(o) }
    }

    // MARK: - Check-in at the office

    @objc func officeStatus(_ call: CAPPluginCall) {
        call.resolve(["permission": OfficeWatcher.shared.status, "watching": OfficeWatcher.shared.watching])
    }

    @objc func officePermission(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            OfficeWatcher.shared.requestAlways { status in call.resolve(["permission": status]) }
        }
    }

    @objc func officeWatch(_ call: CAPPluginCall) {
        let list = (call.getArray("offices") ?? []).compactMap { $0 as? JSObject }
        let offices: [OfficeWatcher.Office] = list.compactMap { o in
            guard let id = o["id"] as? String, let lat = o["lat"] as? Double, let lng = o["lng"] as? Double else { return nil }
            let radius = (o["radius"] as? Double) ?? Double((o["radius"] as? Int) ?? 150)
            return OfficeWatcher.Office(id: id, name: (o["name"] as? String) ?? "the office", lat: lat, lng: lng, radius: radius)
        }
        let workDays = (call.getArray("workDays") ?? []).compactMap { v -> Int? in
            if let i = v as? Int { return i }
            if let d = v as? Double { return Int(d) }
            return nil
        }
        DispatchQueue.main.async {
            OfficeWatcher.shared.watch(offices, workDays: workDays.isEmpty ? [0, 1, 2, 3, 4] : workDays)
            call.resolve(["watching": OfficeWatcher.shared.watching])
        }
    }

    @objc func officeStop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            OfficeWatcher.shared.stop()
            call.resolve()
        }
    }

    @objc func officeMarkCheckedIn(_ call: CAPPluginCall) {
        OfficeWatcher.shared.markCheckedIn(day: call.getString("day") ?? OfficeWatcher.today())
        call.resolve()
    }

    @objc func officePending(_ call: CAPPluginCall) {
        if let p = OfficeWatcher.shared.takePending() {
            call.resolve(["kind": p["kind"] ?? "in", "at": p["at"] ?? "", "place": p["place"] ?? ""])
        } else {
            call.resolve([:])
        }
    }

    // MARK: - Face ID

    @objc func biometry(_ call: CAPPluginCall) {
        let ctx = LAContext()
        var err: NSError?
        let ok = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err)
        var type = "none"
        switch ctx.biometryType {
        case .faceID: type = "faceID"
        case .touchID: type = "touchID"
        default: type = ok ? "other" : "none"
        }
        call.resolve(["available": ok, "type": type])
    }

    @objc func authenticate(_ call: CAPPluginCall) {
        let ctx = LAContext()
        ctx.localizedFallbackTitle = "Use Passcode"
        let reason = call.getString("reason") ?? "Unlock Northcroft"
        // Face ID, falling back to the phone's passcode.
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, error in
            DispatchQueue.main.async {
                if ok {
                    call.resolve(["ok": true])
                } else {
                    let code = (error as? LAError)?.code
                    let why: String
                    switch code {
                    case .userCancel?, .appCancel?, .systemCancel?: why = "cancelled"
                    case .biometryLockout?: why = "lockout"
                    case .passcodeNotSet?: why = "no-passcode"
                    default: why = "failed"
                    }
                    call.resolve(["ok": false, "reason": why])
                }
            }
        }
    }

    // MARK: - Files shared in from other apps

    @objc func shareInbox(_ call: CAPPluginCall) {
        guard let root = SharedInbox.root,
              let dirs = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.creationDateKey], options: [.skipsHiddenFiles]) else {
            call.resolve([:])
            return
        }
        // The newest batch that has its list of files.
        let sorted = dirs.sorted { a, b in
            let da = (try? a.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
            let db = (try? b.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
            return da > db
        }
        for dir in sorted {
            let manifest = dir.appendingPathComponent("manifest.json")
            guard let data = try? Data(contentsOf: manifest),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            var batch = JSTypes.coerceDictionaryToJSObject(json) ?? [:]
            batch["dir"] = dir.path
            call.resolve(["batch": batch])
            return
        }
        call.resolve([:])
    }

    @objc func readShared(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let root = SharedInbox.root else {
            call.reject("No file")
            return
        }
        let url = URL(fileURLWithPath: path).standardizedFileURL
        guard url.path.hasPrefix(root.standardizedFileURL.path) else {
            call.reject("Not a shared file")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let data = try Data(contentsOf: url)
                call.resolve(["data": data.base64EncodedString()])
            } catch {
                call.reject("Couldn't read the shared file")
            }
        }
    }

    @objc func clearShared(_ call: CAPPluginCall) {
        if let id = call.getString("id"), let root = SharedInbox.root, !id.contains("/"), !id.isEmpty {
            try? FileManager.default.removeItem(at: root.appendingPathComponent(id, isDirectory: true))
        }
        call.resolve()
    }

    // MARK: - App icon badge

    @objc func setBadge(_ call: CAPPluginCall) {
        let count = max(0, call.getInt("count") ?? 0)
        DispatchQueue.main.async {
            if #available(iOS 16.0, *) {
                UNUserNotificationCenter.current().setBadgeCount(count, withCompletionHandler: nil)
            } else {
                UIApplication.shared.applicationIconBadgeNumber = count
            }
            call.resolve()
        }
    }
}

// MARK: - Document scanner, launch actions, widget

extension NorthcroftNativePlugin {
    @objc func scanDocument(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard DocumentScanner.isSupported else {
                call.resolve(["supported": false])
                return
            }
            guard let host = self.bridge?.viewController else {
                call.reject("Couldn't open the scanner")
                return
            }
            DocumentScanner.present(from: host) { outcome in
                switch outcome {
                case .pdf(let data, let pages):
                    let f = DateFormatter()
                    f.locale = Locale(identifier: "en_US_POSIX")
                    f.dateFormat = "yyyy-MM-dd HH.mm"
                    call.resolve([
                        "supported": true,
                        "data": data.base64EncodedString(),
                        "name": "Scan \(f.string(from: Date())).pdf",
                        "pages": pages
                    ])
                case .cancelled:
                    call.resolve(["supported": true, "cancelled": true])
                case .failed(let why):
                    call.reject(why)
                }
            }
        }
    }

    @objc func takeLaunchAction(_ call: CAPPluginCall) {
        if let a = LaunchActions.take() {
            var out: [String: Any] = ["action": a.action]
            if let p = a.path { out["path"] = p }
            call.resolve(out)
        } else {
            call.resolve([:])
        }
    }

    @objc func updateWidget(_ call: CAPPluginCall) {
        let json = (call.options as? [String: Any]) ?? [:]
        call.resolve(["saved": WidgetData.save(json)])
    }

    @objc func clearWidget(_ call: CAPPluginCall) {
        WidgetData.clear()
        Task {
            if #available(iOS 16.2, *) {
                await LiveWorkday.endAll()
                await LiveTasks.endAll()
            }
        }
        DispatchQueue.main.async {
            SiteTrip.shared.stop()
            SiteWatcher.shared.stop()
        }
        SpotlightIndex.clear()
        call.resolve()
    }

    // MARK: - Live Activity, Spotlight, Calendar, haptics

    @objc func workday(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["running": false])
            return
        }
        let checkedIn = call.getBool("checkedIn") ?? false
        let checkedOut = call.getBool("checkedOut") ?? false
        let at = call.getDouble("checkInAtMs").map { Date(timeIntervalSince1970: $0 / 1000) }
        let place = call.getString("place")
        let due = call.getInt("dueToday") ?? 0
        let late = call.getInt("late") ?? 0
        let name = call.getString("firstName") ?? ""
        let endAt = call.getDouble("endAtMs").map { Date(timeIntervalSince1970: $0 / 1000) }
        Task {
            let running = await LiveWorkday.sync(checkedIn: checkedIn, checkedOut: checkedOut, checkInAt: at, place: place, dueToday: due, late: late, endAt: endAt, firstName: name)
            call.resolve(["running": running])
        }
    }

    @objc func spotlightIndex(_ call: CAPPluginCall) {
        let items = Self.plainList(call.getArray("items"))
        SpotlightIndex.replace(items) { count in call.resolve(["indexed": count]) }
    }

    @objc func spotlightClear(_ call: CAPPluginCall) {
        SpotlightIndex.clear()
        call.resolve()
    }

    @objc func calendarStatus(_ call: CAPPluginCall) {
        call.resolve(["permission": CalendarSync.status()])
    }

    @objc func calendarEnable(_ call: CAPPluginCall) {
        CalendarSync.requestAccess { ok in
            call.resolve(["permission": ok ? "granted" : CalendarSync.status()])
        }
    }

    @objc func calendarSync(_ call: CAPPluginCall) {
        guard CalendarSync.status() == "granted" else {
            call.resolve(["synced": false, "permission": CalendarSync.status()])
            return
        }
        let items = Self.plainList(call.getArray("events"))
        DispatchQueue.global(qos: .utility).async {
            do {
                let n = try CalendarSync.sync(items)
                call.resolve(["synced": true, "count": n])
            } catch {
                call.reject("Couldn't update the Northcroft calendar: \(error.localizedDescription)")
            }
        }
    }

    @objc func calendarDisable(_ call: CAPPluginCall) {
        CalendarSync.remove()
        call.resolve()
    }

    /// A list of objects from JavaScript as plain dictionaries.
    static func plainList(_ arr: JSArray?) -> [[String: Any]] {
        (arr ?? []).compactMap { $0 as? JSObject }.map { obj in
            var d: [String: Any] = [:]
            for (k, v) in obj { d[k] = v }
            return d
        }
    }

    @objc func haptic(_ call: CAPPluginCall) {
        Haptics.play(call.getString("style") ?? "light")
    }

    // MARK: - Tasks on the lock screen, site trips and the site visit log

    @objc func liveTasks(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["running": 0])
            return
        }
        let items = Self.plainList(call.getArray("items"))
        Task {
            let n = await LiveTasks.sync(items)
            call.resolve(["running": n])
        }
    }

    @objc func tripStart(_ call: CAPPluginCall) {
        guard let id = call.getString("placeId"), let lat = call.getDouble("lat"), let lng = call.getDouble("lng") else {
            call.reject("placeId, lat and lng are needed")
            return
        }
        let name = call.getString("placeName") ?? "Site"
        let radius = call.getDouble("radius") ?? 200
        let project = call.getString("projectId")
        DispatchQueue.main.async {
            SiteTrip.shared.start(id: id, name: name, lat: lat, lng: lng, radius: radius, projectId: project) { problem in
                if let problem { call.resolve(["ok": false, "reason": problem]) } else { call.resolve(["ok": true]) }
            }
        }
    }

    @objc func tripStop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            SiteTrip.shared.stop()
            call.resolve()
        }
    }

    @objc func tripStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let r = SiteTrip.shared.running {
                var out: JSObject = ["running": true]
                for (k, v) in r {
                    if let s = v as? String { out[k] = s } else if let d = v as? Double { out[k] = d }
                }
                call.resolve(out)
            } else {
                call.resolve(["running": false])
            }
        }
    }

    @objc func siteWatch(_ call: CAPPluginCall) {
        let list = (call.getArray("sites") ?? []).compactMap { $0 as? JSObject }
        let sites: [SiteWatcher.Site] = list.compactMap { o in
            guard let id = o["id"] as? String, let lat = o["lat"] as? Double, let lng = o["lng"] as? Double else { return nil }
            let radius = (o["radius"] as? Double) ?? Double((o["radius"] as? Int) ?? 200)
            return SiteWatcher.Site(id: id, name: (o["name"] as? String) ?? "Site", lat: lat, lng: lng, radius: radius, projectId: o["projectId"] as? String)
        }
        DispatchQueue.main.async {
            OfficeWatcher.shared.requestAlways { status in
                guard status == "always" || status == "whenInUse" else {
                    call.resolve(["status": status, "watching": 0])
                    return
                }
                let n = SiteWatcher.shared.watch(sites)
                call.resolve(["status": status, "watching": n])
            }
        }
    }

    @objc func siteStop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            SiteWatcher.shared.stop()
            call.resolve()
        }
    }

    @objc func siteTake(_ call: CAPPluginCall) {
        let events: JSArray = SiteVisits.take().map { e in
            var o: JSObject = [:]
            for (k, v) in e {
                if let s = v as? String { o[k] = s } else if let d = v as? Double { o[k] = d }
            }
            return o
        }
        call.resolve(["events": events])
    }

    // MARK: - This phone, and voice calls

    @objc func phoneStatus(_ call: CAPPluginCall) {
        PhoneStatus.read { info in
            var out: JSObject = [:]
            for (k, v) in info {
                if let b = v as? Bool { out[k] = b } else if let i = v as? Int { out[k] = i } else if let s = v as? String { out[k] = s }
            }
            call.resolve(out)
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        PhoneStatus.openSettings(call.getString("kind"))
        call.resolve()
    }

    @objc func callAudio(_ call: CAPPluginCall) {
        CallAudio.set(active: call.getBool("active") ?? false, speaker: call.getBool("speaker") ?? false)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            call.resolve(["route": CallAudio.route])
        }
    }

    @objc func appIcon(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            var out: [String: Any] = ["supported": UIApplication.shared.supportsAlternateIcons]
            if let name = UIApplication.shared.alternateIconName { out["current"] = name }
            call.resolve(out)
        }
    }

    @objc func addWalletPass(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else { return call.reject("No pass") }
        DispatchQueue.main.async {
            guard PKAddPassesViewController.canAddPasses() else { return call.resolve(["added": false, "reason": "Wallet isn't available on this iPhone."]) }
            let pass: PKPass
            do { pass = try PKPass(data: data) } catch { return call.resolve(["added": false, "reason": "The pass couldn't be read."]) }
            if PKPassLibrary().containsPass(pass) { return call.resolve(["added": true, "already": true]) }
            guard let vc = PKAddPassesViewController(pass: pass), let host = self.bridge?.viewController else {
                return call.resolve(["added": false, "reason": "Wallet couldn't open."])
            }
            host.present(vc, animated: true)
            call.resolve(["added": true])
        }
    }

    @objc func setAppIcon(_ call: CAPPluginCall) {
        let name = call.getString("name")
        DispatchQueue.main.async {
            guard UIApplication.shared.supportsAlternateIcons else { return call.resolve(["ok": false]) }
            if UIApplication.shared.alternateIconName == name { return call.resolve(["ok": true]) }
            UIApplication.shared.setAlternateIconName(name) { error in
                call.resolve(error == nil ? ["ok": true] : ["ok": false, "reason": error!.localizedDescription])
            }
        }
    }
}

/// Where the share extension leaves files for the app: the shared app group folder "Shared",
/// one folder per share with a manifest.json listing what's in it.
enum SharedInbox {
    static var group: String { AppGroup.id }

    static var root: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent("Shared", isDirectory: true)
    }
}
