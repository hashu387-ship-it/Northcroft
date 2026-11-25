import Foundation
import ActivityKit

/// The workday Live Activity: on the lock screen and in the Dynamic Island from check-in until
/// check-out (or midnight), with the time since check-in counting up and a Check out button.
/// The widget extension draws it (ios/App/NorthcroftWidget/WorkdayLiveActivity.swift), with its own
/// copy of these attributes: the two must stay field for field the same.
public struct WorkdayAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var checkInAt: Date
        public var place: String?
        public var dueToday: Int
        public var late: Int
    }

    public var firstName: String
}

@available(iOS 16.2, *)
enum LiveWorkday {
    static let zone = TimeZone(identifier: "Asia/Riyadh") ?? .current

    /// Starts, updates or ends the Live Activity to match today's check-in.
    static func sync(checkedIn: Bool, checkedOut: Bool, checkInAt: Date?, place: String?, dueToday: Int, late: Int, firstName: String) async -> Bool {
        let running = Activity<WorkdayAttributes>.activities
        guard checkedIn, !checkedOut, let at = checkInAt, ActivityAuthorizationInfo().areActivitiesEnabled else {
            for a in running { await a.end(nil, dismissalPolicy: .immediate) }
            return false
        }
        let state = WorkdayAttributes.ContentState(checkInAt: at, place: place, dueToday: dueToday, late: late)
        let content = ActivityContent(state: state, staleDate: nextMidnight(after: Date()))
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone
        // Today's activity is updated; one from another day (or a second one) is ended.
        var kept = false
        for a in running {
            if !kept, cal.isDate(a.content.state.checkInAt, inSameDayAs: at) {
                if a.content.state != state { await a.update(content) }
                kept = true
            } else {
                await a.end(nil, dismissalPolicy: .immediate)
            }
        }
        if kept { return true }
        do {
            _ = try Activity.request(attributes: WorkdayAttributes(firstName: firstName), content: content, pushType: nil)
            return true
        } catch {
            return false
        }
    }

    static func endAll() async {
        for a in Activity<WorkdayAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
    }

    private static func nextMidnight(after d: Date) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone
        return cal.nextDate(after: d, matching: DateComponents(hour: 0, minute: 0), matchingPolicy: .nextTime) ?? d.addingTimeInterval(12 * 3600)
    }
}
