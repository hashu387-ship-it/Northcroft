import AppIntents
import NorthcroftNativePlugin

// Siri and the Shortcuts app: "Check me in with Northcroft", "Scan a document with Northcroft",
// "Show my Northcroft tasks", "Open Northcroft chats". They also appear in Spotlight and can go on
// the Action button. Each one opens Northcroft and leaves the action for the web app to do
// (LaunchActions), because it needs the person's sign-in.

@available(iOS 16.0, *)
struct CheckInIntent: AppIntent {
    static var title: LocalizedStringResource = "Check in"
    static var description = IntentDescription("Opens Northcroft and checks you in where you are, with the same office rule as the Check in button.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        LaunchActions.set("checkin")
        return .result()
    }
}

@available(iOS 16.0, *)
struct ScanDocumentIntent: AppIntent {
    static var title: LocalizedStringResource = "Scan a document"
    static var description = IntentDescription("Opens Northcroft's document scanner. The scan becomes a PDF you can send to a chat or one of your tasks.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        LaunchActions.set("scan")
        return .result()
    }
}

@available(iOS 16.0, *)
struct OpenTasksIntent: AppIntent {
    static var title: LocalizedStringResource = "My tasks"
    static var description = IntentDescription("Opens your tasks in Northcroft.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        LaunchActions.set("tasks")
        return .result()
    }
}

@available(iOS 16.0, *)
struct OpenChatsIntent: AppIntent {
    static var title: LocalizedStringResource = "Chats"
    static var description = IntentDescription("Opens your chats in Northcroft.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        LaunchActions.set("chats")
        return .result()
    }
}

/// The phrases Siri listens for. Each must say the app's name (Northcroft).
@available(iOS 16.0, *)
struct NorthcroftShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CheckInIntent(),
            phrases: [
                "Check me in with \(.applicationName)",
                "Check in on \(.applicationName)",
                "\(.applicationName) check in"
            ],
            shortTitle: "Check in",
            systemImageName: "mappin.and.ellipse")
        AppShortcut(
            intent: ScanDocumentIntent(),
            phrases: [
                "Scan a document with \(.applicationName)",
                "Scan with \(.applicationName)",
                "\(.applicationName) scan"
            ],
            shortTitle: "Scan a document",
            systemImageName: "doc.viewfinder")
        AppShortcut(
            intent: OpenTasksIntent(),
            phrases: [
                "Show my \(.applicationName) tasks",
                "Open my tasks in \(.applicationName)",
                "\(.applicationName) tasks"
            ],
            shortTitle: "My tasks",
            systemImageName: "checklist")
        AppShortcut(
            intent: OpenChatsIntent(),
            phrases: [
                "Open \(.applicationName) chats",
                "Show my chats in \(.applicationName)",
                "\(.applicationName) chats"
            ],
            shortTitle: "Chats",
            systemImageName: "bubble.left.and.bubble.right")
    }
}
