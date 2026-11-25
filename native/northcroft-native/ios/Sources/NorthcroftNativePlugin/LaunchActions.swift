import Foundation

/// Something the person asked for before the web app was ready to do it: a Siri or Shortcuts
/// action, a press-and-hold item on the app icon, or a tap on the widget. It's kept here until the
/// web app takes it (NorthcroftNative.takeLaunchAction), then done there, because doing it needs
/// the person's sign-in.
///   checkin  check in now (the same office-location rule as the Check in button)
///   scan     open the document scanner
///   tasks    open My tasks
///   chats    open Chats
public enum LaunchActions {
    public static let didChange = Notification.Name("NorthcroftLaunchActionDidChange")
    public static let all: Set<String> = ["checkin", "scan", "tasks", "chats"]

    private static let key = "nc.launchAction"
    /// An action nobody picked up within this time is dropped, so it never fires by surprise later.
    private static let maxAge: TimeInterval = 10 * 60

    public static func set(_ action: String) {
        guard all.contains(action) else { return }
        UserDefaults.standard.set(["action": action, "at": Date().timeIntervalSince1970], forKey: key)
        NotificationCenter.default.post(name: didChange, object: action)
    }

    /// The waiting action, which is then forgotten.
    public static func take() -> String? {
        guard let d = UserDefaults.standard.dictionary(forKey: key) else { return nil }
        UserDefaults.standard.removeObject(forKey: key)
        guard let action = d["action"] as? String, all.contains(action) else { return nil }
        let at = (d["at"] as? Double) ?? 0
        return Date().timeIntervalSince1970 - at <= maxAge ? action : nil
    }

    /// northcroft://action/<name>, used by the widget. true if it was one of these.
    @discardableResult
    public static func handle(url: URL) -> Bool {
        guard url.scheme?.lowercased() == "northcroft", url.host?.lowercased() == "action" else { return false }
        let name = url.pathComponents.filter { $0 != "/" }.first?.lowercased() ?? ""
        guard all.contains(name) else { return false }
        set(name)
        return true
    }

    /// The items on the app icon's press-and-hold menu (UIApplicationShortcutItems in Info.plist),
    /// whose types are northcroft.<name>. true if it was one of these.
    @discardableResult
    public static func handle(shortcutType type: String) -> Bool {
        let name = type.components(separatedBy: ".").last?.lowercased() ?? ""
        guard type.hasPrefix("northcroft."), all.contains(name) else { return false }
        set(name)
        return true
    }
}
