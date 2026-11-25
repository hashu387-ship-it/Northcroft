import AppIntents

// Siri and the Shortcuts app: the phrases for the actions in Shared/NorthcroftActionIntents.swift.
// They also appear in Spotlight and can go on the Action button. Each phrase must say the app's
// name (Northcroft).

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
            intent: CheckOutIntent(),
            phrases: [
                "Check me out with \(.applicationName)",
                "Check out on \(.applicationName)",
                "\(.applicationName) check out"
            ],
            shortTitle: "Check out",
            systemImageName: "figure.walk.departure")
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
