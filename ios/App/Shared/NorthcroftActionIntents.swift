import AppIntents
import Foundation

// The actions Siri, the Shortcuts app and the Control Center buttons run: Check in, Check out,
// Scan a document, My tasks, Chats. This file is built into both the app and the widget extension
// (the Control Center buttons live there); each action opens Northcroft and leaves itself for the
// web app to do, because it needs the person's sign-in.
// The phrases Siri listens for are in App/NorthcroftIntents.swift.

/// Leaves the action where the app looks for it: the same key and app group as LaunchActions in
/// native/northcroft-native, which the app uses to take it.
enum PendingAction {
    static let didChange = Notification.Name("NorthcroftLaunchActionDidChange")

    static var group: String {
        if let v = Bundle.main.object(forInfoDictionaryKey: "NCAppGroup") as? String, !v.isEmpty, !v.contains("$(") { return v }
        return "group.com.northcroftme.qsteam"
    }

    static func set(_ action: String) {
        let defaults = UserDefaults(suiteName: group) ?? .standard
        defaults.set(["action": action, "at": Date().timeIntervalSince1970], forKey: "nc.launchAction")
        NotificationCenter.default.post(name: didChange, object: action)
    }
}

@available(iOS 16.0, *)
struct CheckInIntent: AppIntent {
    static var title: LocalizedStringResource = "Check in"
    static var description = IntentDescription("Opens Northcroft and checks you in where you are, with the same office rule as the Check in button.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        PendingAction.set("checkin")
        return .result()
    }
}

@available(iOS 16.0, *)
struct CheckOutIntent: AppIntent {
    static var title: LocalizedStringResource = "Check out"
    static var description = IntentDescription("Opens Check in in Northcroft, ready to check out.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        PendingAction.set("checkout")
        return .result()
    }
}

@available(iOS 16.0, *)
struct ScanDocumentIntent: AppIntent {
    static var title: LocalizedStringResource = "Scan a document"
    static var description = IntentDescription("Opens Northcroft's document scanner. The scan becomes a searchable PDF you can send to a chat or one of your tasks.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        PendingAction.set("scan")
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
        PendingAction.set("tasks")
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
        PendingAction.set("chats")
        return .result()
    }
}

// MARK: - Answers without opening the app

/// The copy of today the widget shows (WidgetData in native/northcroft-native saves it), read here so
/// Siri can answer from it without opening the app.
private struct TodayCopy: Decodable {
    struct Item: Decodable {
        let title: String
        let due: String?
        let project: String?
        let late: Bool?
    }
    let day: String
    let firstName: String?
    let exempt: Bool?
    let checkedIn: Bool
    let checkInAt: String?
    let dueToday: Int
    let late: Int
    let tasks: [Item]

    static func load() -> TodayCopy? {
        guard let data = UserDefaults(suiteName: PendingAction.group)?.data(forKey: "widget.snapshot") else { return nil }
        return try? JSONDecoder().decode(TodayCopy.self, from: data)
    }

    /// The copy is from today (Riyadh time).
    var current: Bool {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Riyadh")
        f.dateFormat = "yyyy-MM-dd"
        return day == f.string(from: Date())
    }
}

@available(iOS 16.0, *)
struct DueTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "What's due today"
    static var description = IntentDescription("Tells you which of your Northcroft tasks are due today and which are late, without opening the app.")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let t = TodayCopy.load(), t.current else {
            return .result(dialog: "Open Northcroft once today and I'll be able to tell you.")
        }
        if t.dueToday == 0 && t.late == 0 {
            return .result(dialog: "Nothing's due today, and nothing is late.")
        }
        var parts: [String] = []
        if t.dueToday > 0 { parts.append(t.dueToday == 1 ? "One task is due today" : "\(t.dueToday) tasks are due today") }
        if t.late > 0 { parts.append(t.late == 1 ? "one is late" : "\(t.late) are late") }
        let names = t.tasks.prefix(3).map { $0.title }
        let list = names.isEmpty ? "" : ": " + ListFormatter.localizedString(byJoining: Array(names))
        return .result(dialog: "\(parts.joined(separator: ", and "))\(list).")
    }
}

@available(iOS 16.0, *)
struct CheckInStatusIntent: AppIntent {
    static var title: LocalizedStringResource = "Am I checked in?"
    static var description = IntentDescription("Tells you whether you've checked in today, and when.")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let t = TodayCopy.load(), t.current else {
            return .result(dialog: "Open Northcroft once today and I'll be able to tell you.")
        }
        if t.exempt ?? false { return .result(dialog: "You don't need to check in.") }
        if t.checkedIn { return .result(dialog: "Yes, you checked in at \(t.checkInAt ?? "the start of the day").") }
        return .result(dialog: "Not yet. Say \"Check me in with Northcroft\" to check in.")
    }
}
