import AppIntents
import WidgetKit
import SwiftUI

// The Northcroft home screen and lock screen widget: whether you've checked in today, and your
// tasks due today. The widget can't sign in, so it shows the latest copy the app saved in the
// shared app group (WidgetData in native/northcroft-native). Tapping it opens the app through
// northcroft://action/<checkin|tasks>, which SceneDelegate hands to LaunchActions.

// MARK: - Data

private enum Shared {
    static var group: String {
        if let v = Bundle.main.object(forInfoDictionaryKey: "NCAppGroup") as? String, !v.isEmpty, !v.contains("$(") { return v }
        return "group.com.northcroftme.qsteam"
    }
    static let key = "widget.snapshot"
}

struct Snapshot: Decodable {
    struct Item: Decodable, Identifiable {
        let id: String
        let title: String
        /// "Today", "Yesterday", "3 days late"...
        let due: String?
        let project: String?
        let late: Bool?
    }

    /// The day the copy was made (yyyy-MM-dd). On a later day, "checked in" no longer applies.
    let day: String
    let firstName: String?
    /// Doesn't check in (attendance exempt): the widget shows tasks only.
    let exempt: Bool?
    let checkedIn: Bool
    let checkInAt: String?
    let checkedOut: Bool?
    let checkOutAt: String?
    let place: String?
    let dueToday: Int
    let late: Int
    let tasks: [Item]

    static func load() -> Snapshot? {
        guard let data = UserDefaults(suiteName: Shared.group)?.data(forKey: Shared.key) else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }

    static let sample = Snapshot(
        day: DayEntry.dayString(Date()), firstName: "Hassan", exempt: false,
        checkedIn: true, checkInAt: "8:12 AM", checkedOut: false, checkOutAt: nil, place: "Riyadh office",
        dueToday: 3, late: 1,
        tasks: [
            Item(id: "1", title: "Interim payment 7 valuation", due: "Today", project: "Diriyah", late: false),
            Item(id: "2", title: "VO-14 rate build-up", due: "Yesterday", project: "Qiddiya", late: true),
            Item(id: "3", title: "Ceiling take-off, level 2", due: "Today", project: "HOAS", late: false)
        ])
}

struct DayEntry: TimelineEntry {
    let date: Date
    let snap: Snapshot?

    /// The copy is from today, so its check-in and "due today" still apply.
    var current: Bool {
        guard let s = snap else { return false }
        return s.day == DayEntry.dayString(date)
    }

    /// The app counts days in Riyadh time, so the widget does too.
    static let zone = TimeZone(identifier: "Asia/Riyadh") ?? .current

    static func dayString(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = zone
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> DayEntry {
        DayEntry(date: Date(), snap: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (DayEntry) -> Void) {
        completion(DayEntry(date: Date(), snap: context.isPreview ? (Snapshot.load() ?? .sample) : Snapshot.load()))
    }

    /// Now, and again just after midnight so yesterday's check-in doesn't linger. The app also
    /// asks for a redraw whenever the data changes.
    func getTimeline(in context: Context, completion: @escaping (Timeline<DayEntry>) -> Void) {
        let now = Date()
        let snap = Snapshot.load()
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = DayEntry.zone
        let midnight = cal.nextDate(after: now, matching: DateComponents(hour: 0, minute: 1), matchingPolicy: .nextTime) ?? now.addingTimeInterval(3600)
        let entries = [DayEntry(date: now, snap: snap), DayEntry(date: midnight, snap: snap)]
        completion(Timeline(entries: entries, policy: .after(midnight.addingTimeInterval(60 * 60))))
    }
}

// MARK: - Look
// Apple's own widget style (Reminders, Calendar): white in light mode, dark grey in dark mode, black
// text, Apple blue for Northcroft's name and buttons, red only for what's late. In StandBy and on
// tinted or clear Home Screens the system takes over the background and colours.

private enum Links {
    static let checkin = URL(string: "northcroft://action/checkin")!
    static let tasks = URL(string: "northcroft://action/tasks")!
}

/// "Checked in 8:12 AM", with where.
private struct CheckInBlock: View {
    let entry: DayEntry
    var compact = false

    var body: some View {
        let s = entry.snap
        let checkedIn = entry.current && (s?.checkedIn ?? false)
        let out = entry.current && (s?.checkedOut ?? false)
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Image(systemName: out ? "figure.walk.departure" : checkedIn ? "checkmark.circle.fill" : "mappin.circle.fill")
                    .foregroundStyle(checkedIn ? Color.green : Color.orange)
                    .font(.system(size: compact ? 16 : 19, weight: .semibold))
                    .widgetAccentable()
                    .contentTransition(.symbolEffect(.replace))
                Text(out ? "Checked out" : checkedIn ? "Checked in" : "Not checked in")
                    .font(.system(size: compact ? 14 : 15, weight: .semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            if checkedIn, let t = out ? s?.checkOutAt : s?.checkInAt {
                Text([t, s?.place].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        // Checking in or out slides the new state in.
        .id(out ? 2 : checkedIn ? 1 : 0)
        .transition(.push(from: .bottom))
    }
}

/// The Check in button on the widget itself (iOS 17): opens Northcroft and checks in, with the same
/// office rule as the app's button.
private struct CheckInButton: View {
    var body: some View {
        Button(intent: CheckInIntent()) {
            Label("Check in", systemImage: "mappin.and.ellipse")
                .font(.system(size: 13, weight: .semibold))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
        .tint(.blue)
        .widgetAccentable()
    }
}

/// "3 due today · 1 late".
private struct DueLine: View {
    let entry: DayEntry

    var body: some View {
        if let s = entry.snap, entry.current {
            HStack(spacing: 4) {
                Text(s.dueToday == 0 ? "Nothing due today" : "\(s.dueToday) due today")
                    .foregroundStyle(.secondary)
                    .contentTransition(.numericText())
                if s.late > 0 {
                    Text("· \(s.late) late")
                        .foregroundStyle(Color.red)
                        .widgetAccentable()
                        .contentTransition(.numericText())
                }
            }
            .font(.system(size: 12, weight: .medium))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
        } else {
            Text("Open Northcroft to refresh")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
        }
    }
}

private struct Brand: View {
    var body: some View {
        Text("Northcroft")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Color.blue)
            .widgetAccentable()
    }
}

/// One task: a ring like Reminders, the title, and the project and when it's due.
private struct TaskLine: View {
    let t: Snapshot.Item
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "circle")
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle((t.late ?? false) ? Color.red : Color.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(t.title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Text([t.project, t.due].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 11))
                    .foregroundStyle((t.late ?? false) ? Color.red : Color.secondary)
                    .lineLimit(1)
            }
        }
    }
}

struct SmallView: View {
    let entry: DayEntry

    var body: some View {
        let exempt = entry.snap?.exempt ?? false
        let checkedIn = entry.current && (entry.snap?.checkedIn ?? false)
        VStack(alignment: .leading, spacing: 6) {
            Brand()
            Spacer(minLength: 0)
            if entry.snap == nil {
                Text("Open Northcroft to sign in")
                    .font(.system(size: 14, weight: .semibold))
            } else if exempt {
                let n = entry.current ? (entry.snap?.dueToday ?? 0) : 0
                Text("\(n)")
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .contentTransition(.numericText())
                DueLine(entry: entry)
            } else {
                CheckInBlock(entry: entry)
                DueLine(entry: entry)
                if !checkedIn && entry.current { CheckInButton().padding(.top, 2) }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct MediumView: View {
    let entry: DayEntry

    var body: some View {
        let exempt = entry.snap?.exempt ?? false
        let checkedIn = entry.current && (entry.snap?.checkedIn ?? false)
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Brand()
                Spacer(minLength: 0)
                if entry.snap == nil {
                    Text("Open Northcroft to sign in")
                        .font(.system(size: 14, weight: .semibold))
                } else {
                    if !exempt { Link(destination: Links.checkin) { CheckInBlock(entry: entry, compact: true) } }
                    DueLine(entry: entry)
                    if !exempt && !checkedIn && entry.current { CheckInButton().padding(.top, 2) }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            Link(destination: Links.tasks) {
                VStack(alignment: .leading, spacing: 7) {
                    Text("Due today")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.secondary)
                    let tasks = entry.current ? (entry.snap?.tasks ?? []) : []
                    if tasks.isEmpty {
                        Text(entry.current ? "You're all clear" : "Open Northcroft")
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)
                    }
                    ForEach(tasks.prefix(3)) { t in TaskLine(t: t) }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
    }
}

/// The large widget: check-in on top, then up to five tasks, like a Reminders list.
struct LargeView: View {
    let entry: DayEntry

    var body: some View {
        let exempt = entry.snap?.exempt ?? false
        let checkedIn = entry.current && (entry.snap?.checkedIn ?? false)
        let tasks = entry.current ? (entry.snap?.tasks ?? []) : []
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Brand()
                Spacer()
                if let name = entry.snap?.firstName { Text(name).font(.system(size: 13)).foregroundStyle(.secondary) }
            }
            if entry.snap == nil {
                Spacer()
                Text("Open Northcroft to sign in").font(.system(size: 15, weight: .semibold))
                Spacer()
            } else {
                if !exempt {
                    HStack(alignment: .center) {
                        Link(destination: Links.checkin) { CheckInBlock(entry: entry) }
                        Spacer(minLength: 8)
                        if !checkedIn && entry.current { CheckInButton().frame(width: 120) }
                    }
                    Divider()
                }
                Link(destination: Links.tasks) {
                    VStack(alignment: .leading, spacing: 9) {
                        HStack {
                            Text("Due today").font(.system(size: 15, weight: .semibold))
                            Spacer()
                            DueLine(entry: entry)
                        }
                        if tasks.isEmpty {
                            Text(entry.current ? "You're all clear" : "Open Northcroft to refresh")
                                .font(.system(size: 14))
                                .foregroundStyle(.secondary)
                        }
                        ForEach(tasks.prefix(5)) { t in TaskLine(t: t) }
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// Lock screen: two lines under the clock.
struct RectangularView: View {
    let entry: DayEntry

    var body: some View {
        let s = entry.snap
        let exempt = s?.exempt ?? false
        VStack(alignment: .leading, spacing: 1) {
            if s == nil {
                Text("Northcroft").font(.headline)
                Text("Open to sign in").font(.caption)
            } else {
                if !exempt {
                    let inNow = entry.current && (s?.checkedIn ?? false)
                    Label(inNow ? "In \(s?.checkInAt ?? "")" : "Not checked in", systemImage: inNow ? "checkmark.circle" : "mappin.circle")
                        .font(.headline)
                        .lineLimit(1)
                }
                if entry.current, let s {
                    Text(s.late > 0 ? "\(s.dueToday) due today, \(s.late) late" : "\(s.dueToday) due today")
                        .font(.caption)
                        .lineLimit(1)
                } else {
                    Text("Open Northcroft to refresh").font(.caption)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Lock screen: one line above the clock.
struct InlineView: View {
    let entry: DayEntry

    var body: some View {
        let s = entry.snap
        if let s, entry.current {
            if s.exempt ?? false {
                Text("\(s.dueToday) tasks due today")
            } else {
                Text(s.checkedIn ? "In \(s.checkInAt ?? "") · \(s.dueToday) due" : "Not checked in · \(s.dueToday) due")
            }
        } else {
            Text("Northcroft")
        }
    }
}

/// Lock screen: a round gauge with the number due today.
struct CircularView: View {
    let entry: DayEntry

    var body: some View {
        let n = entry.current ? (entry.snap?.dueToday ?? 0) : 0
        let late = entry.current ? (entry.snap?.late ?? 0) : 0
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: -2) {
                Text("\(n)").font(.system(size: 20, weight: .bold, design: .rounded))
                Text(late > 0 ? "\(late) late" : "due").font(.system(size: 10, weight: .medium))
            }
        }
    }
}

struct NorthcroftWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: DayEntry

    var body: some View {
        switch family {
        case .accessoryRectangular:
            RectangularView(entry: entry)
                .widgetURL(Links.tasks)
                .containerBackground(for: .widget) { Color.clear }
        case .accessoryInline:
            InlineView(entry: entry)
                .widgetURL(Links.tasks)
                .containerBackground(for: .widget) { Color.clear }
        case .accessoryCircular:
            CircularView(entry: entry)
                .widgetURL(Links.tasks)
                .containerBackground(for: .widget) { Color.clear }
        case .systemLarge:
            LargeView(entry: entry)
                .containerBackground(for: .widget) { Color(.systemBackground) }
        case .systemMedium:
            MediumView(entry: entry)
                .containerBackground(for: .widget) { Color(.systemBackground) }
        default:
            SmallView(entry: entry)
                .widgetURL(entry.current && (entry.snap?.checkedIn ?? false) || (entry.snap?.exempt ?? false) ? Links.tasks : Links.checkin)
                .containerBackground(for: .widget) { Color(.systemBackground) }
        }
    }
}

// MARK: - The widget

struct NorthcroftTodayWidget: Widget {
    let kind = "NorthcroftToday"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            NorthcroftWidgetView(entry: entry)
        }
        .configurationDisplayName("Northcroft today")
        .description("Whether you've checked in, and your tasks due today.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct NorthcroftWidgets: WidgetBundle {
    var body: some Widget {
        NorthcroftTodayWidget()
        WorkdayLiveActivity()
        TaskLiveActivity()
        TripLiveActivity()
        if #available(iOS 18.0, *) {
            CheckInControl()
        }
        if #available(iOS 18.0, *) {
            ScanControl()
        }
    }
}
