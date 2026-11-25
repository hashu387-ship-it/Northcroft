import Foundation
import UIKit
import Capacitor
import LocalAuthentication
import UserNotifications

/// The web app's way in to the iPhone-only parts (see src/native/plugin.ts for the JavaScript side):
///   office*        check-in at the office (OfficeWatcher)
///   biometry, authenticate   Face ID
///   shareInbox, readShared, clearShared   files shared in from other apps (ShareExtension)
///   setBadge       the number on the app icon
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
        CAPPluginMethod(name: "setBadge", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        // Also done in AppDelegate; repeating it here is harmless and covers an older AppDelegate.
        NorthcroftSetup.start()
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

/// Where the share extension leaves files for the app: the shared app group folder "Shared",
/// one folder per share with a manifest.json listing what's in it.
enum SharedInbox {
    static let group = "group.com.northcroftme.qsteam"

    static var root: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent("Shared", isDirectory: true)
    }
}
