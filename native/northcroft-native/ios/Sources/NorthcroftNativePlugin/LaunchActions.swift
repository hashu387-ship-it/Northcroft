import Foundation
import CoreSpotlight

/// Something the person asked for before the web app was ready to do it: a Siri or Shortcuts
/// action, a Control Center button, a press-and-hold item on the app icon, a tap on the widget or
/// the Live Activity, or a Spotlight result. It's kept until the web app takes it
/// (NorthcroftNative.takeLaunchAction), then done there, because doing it needs the person's sign-in.
///   checkin   check in now (the same office-location rule as the Check in button)
///   checkout  open Check in to check out
///   scan      open the document scanner
///   tasks     open My tasks
///   chats     open Chats
///   open      open a page of the app (path), from Spotlight or the Calendar
///
/// It's kept in the shared app group, so the Control Center buttons (built into the widget
/// extension too, see ios/App/Shared/NorthcroftActionIntents.swift) leave it in the same place.
public enum LaunchActions {
    public static let didChange = Notification.Name("NorthcroftLaunchActionDidChange")
    public static let all: Set<String> = ["checkin", "checkout", "scan", "tasks", "chats", "open"]

    static let key = "nc.launchAction"
    /// An action nobody picked up within this time is dropped, so it never fires by surprise later.
    private static let maxAge: TimeInterval = 10 * 60
    /// The pages Spotlight and the Calendar may open.
    private static let pathPattern = "^/(tasks|projects|chats|attendance|my-tasks|calendar|call|calls)(/[A-Za-z0-9-]+)?$"

    private static var store: UserDefaults { AppGroup.defaults ?? .standard }

    public static func set(_ action: String, path: String? = nil) {
        guard all.contains(action) else { return }
        var d: [String: Any] = ["action": action, "at": Date().timeIntervalSince1970]
        if action == "open" {
            guard let p = path, isAllowed(p) else { return }
            d["path"] = p
        }
        store.set(d, forKey: key)
        NotificationCenter.default.post(name: didChange, object: action)
    }

    /// The waiting action (and its page, for "open"), which is then forgotten.
    public static func take() -> (action: String, path: String?)? {
        for defaults in [store, UserDefaults.standard] {
            guard let d = defaults.dictionary(forKey: key) else { continue }
            defaults.removeObject(forKey: key)
            guard let action = d["action"] as? String, all.contains(action) else { continue }
            let at = (d["at"] as? Double) ?? 0
            guard Date().timeIntervalSince1970 - at <= maxAge else { continue }
            return (action, d["path"] as? String)
        }
        return nil
    }

    static func isAllowed(_ path: String) -> Bool {
        path.range(of: pathPattern, options: .regularExpression) != nil
    }

    /// northcroft://action/<name> (widget, Live Activity) and northcroft://open/<page...>
    /// (Calendar events). true if it was one of these.
    @discardableResult
    public static func handle(url: URL) -> Bool {
        guard url.scheme?.lowercased() == "northcroft" else { return false }
        let parts = url.pathComponents.filter { $0 != "/" }
        switch url.host?.lowercased() {
        case "action":
            let name = parts.first?.lowercased() ?? ""
            // End trip on the site trip's Live Activity: done here, nothing for the web app to do.
            if name == "endtrip" {
                SiteTrip.shared.stop()
                return true
            }
            guard all.contains(name), name != "open" else { return false }
            set(name)
            return true
        case "open":
            let path = "/" + parts.joined(separator: "/")
            guard isAllowed(path) else { return false }
            set("open", path: path)
            return true
        default:
            return false
        }
    }

    /// The items on the app icon's press-and-hold menu (UIApplicationShortcutItems in Info.plist),
    /// whose types are northcroft.<name>. true if it was one of these.
    @discardableResult
    public static func handle(shortcutType type: String) -> Bool {
        let name = type.components(separatedBy: ".").last?.lowercased() ?? ""
        guard type.hasPrefix("northcroft."), all.contains(name), name != "open" else { return false }
        set(name)
        return true
    }

    /// A Spotlight result for a task or project (see Spotlight.swift). true if it was one.
    @discardableResult
    public static func handle(activity: NSUserActivity) -> Bool {
        guard activity.activityType == CSSearchableItemActionType,
              let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String,
              id.hasPrefix("nc:") else { return false }
        let path = String(id.dropFirst(3))
        guard isAllowed(path) else { return false }
        set("open", path: path)
        return true
    }
}
