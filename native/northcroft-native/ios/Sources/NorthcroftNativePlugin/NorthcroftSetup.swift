import Foundation
import UserNotifications

/// Called once from AppDelegate at every launch, including when iOS wakes the app in the background
/// because someone arrived at the office: it starts the office watcher (so the arrival reaches it)
/// and registers the buttons shown on notifications.
public enum NorthcroftSetup {
    public static func start() {
        OfficeWatcher.shared.activate()
        NotificationButtons.register()
        WatchBridge.shared.activate()
    }
}

/// The buttons on notifications. The server picks the set with the APNs "category".
///   CHECKIN_REQUEST and LEAVE_REQUEST: Approve, Decline
///   CHAT: Reply (type a message)
/// Each button opens the app, which does the rest (it needs the person's sign-in).
enum NotificationButtons {
    static func register() {
        let approve = UNNotificationAction(identifier: "approve", title: "Approve", options: [.authenticationRequired, .foreground])
        let decline = UNNotificationAction(identifier: "decline", title: "Decline", options: [.authenticationRequired, .destructive, .foreground])
        let reply = UNTextInputNotificationAction(
            identifier: "reply",
            title: "Reply",
            options: [.authenticationRequired, .foreground],
            textInputButtonTitle: "Send",
            textInputPlaceholder: "Message")
        let categories: Set<UNNotificationCategory> = [
            UNNotificationCategory(identifier: "CHECKIN_REQUEST", actions: [approve, decline], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: "LEAVE_REQUEST", actions: [approve, decline], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: "CHAT", actions: [reply], intentIdentifiers: [], options: [])
        ]
        UNUserNotificationCenter.current().setNotificationCategories(categories)
    }
}
