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
        AppShortcut(
            intent: DueTodayIntent(),
            phrases: [
                "What's due today in \(.applicationName)",
                "What's due in \(.applicationName)",
                "\(.applicationName) due today"
            ],
            shortTitle: "Due today",
            systemImageName: "calendar.badge.clock")
        AppShortcut(
            intent: CheckInStatusIntent(),
            phrases: [
                "Am I checked in on \(.applicationName)",
                "\(.applicationName) check-in status"
            ],
            shortTitle: "Am I checked in?",
            systemImageName: "person.badge.clock")
    }
}

/// The Northcroft Focus filter (Settings > Focus > a Focus > Add Filter > Northcroft): while that
/// Focus is on, chat messages, or everything that isn't urgent, arrive quietly in Notification
/// Centre. Calls, approvals and deadlines still come through. The notification extension reads the
/// choice from the shared app group (FocusRules in NorthcroftNotify).
@available(iOS 16.0, *)
struct NorthcroftFocusFilter: SetFocusFilterIntent {
    static var title: LocalizedStringResource = "Northcroft"
    static var description: IntentDescription? = IntentDescription("Choose which Northcroft notifications stay quiet during this Focus.")

    // Both start off: iOS runs this again with the defaults when the Focus turns off, which clears it.
    @Parameter(title: "Quiet chat messages", default: false)
    var quietChats: Bool

    @Parameter(title: "Only urgent alerts", description: "Only calls, approvals and deadlines light up the screen.", default: false)
    var urgentOnly: Bool

    var displayRepresentation: DisplayRepresentation {
        let what = urgentOnly ? "Only urgent alerts" : quietChats ? "Chats arrive quietly" : "Everything as usual"
        return DisplayRepresentation(title: "Northcroft", subtitle: "\(what)")
    }

    func perform() async throws -> some IntentResult {
        let group: String = {
            if let v = Bundle.main.object(forInfoDictionaryKey: "NCAppGroup") as? String, !v.isEmpty, !v.contains("$(") { return v }
            return "group.com.northcroftme.qsteam"
        }()
        let defaults = UserDefaults(suiteName: group)
        // Called with the Focus's settings when it turns on, and with the defaults when it turns off.
        if quietChats || urgentOnly {
            defaults?.set(["quietChats": quietChats, "urgentOnly": urgentOnly], forKey: "focus.filter")
        } else {
            defaults?.removeObject(forKey: "focus.filter")
        }
        return .result()
    }
}
