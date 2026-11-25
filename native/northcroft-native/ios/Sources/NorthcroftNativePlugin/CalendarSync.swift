import Foundation
import EventKit
import UIKit

/// The person's task deadlines, site visits and meetings in the iPhone Calendar, in a calendar of
/// its own called "Northcroft" (which they can hide or colour). The app sends the full list each
/// time; events no longer on it are removed. Only events in that calendar are ever touched.
enum CalendarSync {
    static let store = EKEventStore()
    private static let calendarKey = "nc.calendarId"
    private static let mapKey = "nc.calendarMap"

    static func status() -> String {
        let s = EKEventStore.authorizationStatus(for: .event)
        if #available(iOS 17.0, *) {
            switch s {
            case .fullAccess: return "granted"
            case .writeOnly: return "writeOnly"
            case .denied, .restricted: return "denied"
            case .notDetermined: return "notDetermined"
            default: return "unknown"
            }
        }
        switch s {
        case .authorized: return "granted"
        case .denied, .restricted: return "denied"
        case .notDetermined: return "notDetermined"
        default: return "unknown"
        }
    }

    static func requestAccess(_ done: @escaping (Bool) -> Void) {
        if #available(iOS 17.0, *) {
            store.requestFullAccessToEvents { ok, _ in done(ok) }
        } else {
            store.requestAccess(to: .event) { ok, _ in done(ok) }
        }
    }

    private static func calendar(create: Bool) throws -> EKCalendar? {
        if let id = UserDefaults.standard.string(forKey: calendarKey), let c = store.calendar(withIdentifier: id) {
            return c
        }
        guard create else { return nil }
        let c = EKCalendar(for: .event, eventStore: store)
        c.title = "Northcroft"
        c.cgColor = UIColor(red: 0.91, green: 0.17, blue: 0.20, alpha: 1).cgColor
        // iCloud if they use it (so it's on their Mac too), otherwise on this phone.
        c.source = store.defaultCalendarForNewEvents?.source
            ?? store.sources.first(where: { $0.sourceType == .calDAV })
            ?? store.sources.first(where: { $0.sourceType == .local })
            ?? store.sources.first
        try store.saveCalendar(c, commit: true)
        UserDefaults.standard.set(c.calendarIdentifier, forKey: calendarKey)
        UserDefaults.standard.removeObject(forKey: mapKey)
        return c
    }

    /// items: key, title, allDay, date ("yyyy-MM-dd", all-day), startMs and endMs (timed),
    /// location, notes, path. Returns how many events the calendar holds afterwards.
    static func sync(_ items: [[String: Any]]) throws -> Int {
        guard let cal = try calendar(create: true) else { return 0 }
        var map = (UserDefaults.standard.dictionary(forKey: mapKey) as? [String: String]) ?? [:]
        var keep = Set<String>()
        let dayFormat = DateFormatter()
        dayFormat.calendar = Calendar(identifier: .gregorian)
        dayFormat.locale = Locale(identifier: "en_US_POSIX")
        dayFormat.dateFormat = "yyyy-MM-dd"

        for it in items {
            guard let key = it["key"] as? String, let title = it["title"] as? String else { continue }
            let allDay = (it["allDay"] as? Bool) ?? false
            var start: Date?
            var end: Date?
            if allDay, let d = it["date"] as? String, let day = dayFormat.date(from: d) {
                start = day
                end = day
            } else if let s = it["startMs"] as? Double {
                start = Date(timeIntervalSince1970: s / 1000)
                end = (it["endMs"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) } ?? start?.addingTimeInterval(3600)
            }
            guard let start, let end else { continue }

            var ev = map[key].flatMap { store.calendarItem(withIdentifier: $0) as? EKEvent }
            if let e = ev, e.calendar?.calendarIdentifier != cal.calendarIdentifier { ev = nil }
            let event = ev ?? EKEvent(eventStore: store)
            let url = (it["path"] as? String).flatMap { LaunchActions.isAllowed($0) ? URL(string: "northcroft://open\($0)") : nil }
            let location = it["location"] as? String
            let notes = it["notes"] as? String
            let changed = ev == nil || event.title != title || event.isAllDay != allDay || event.startDate != start
                || event.endDate != end || event.location != location || event.notes != notes || event.url != url
            if changed {
                event.calendar = cal
                event.title = title
                event.isAllDay = allDay
                event.startDate = start
                event.endDate = end
                event.location = location
                event.notes = notes
                event.url = url
                try store.save(event, span: .thisEvent, commit: false)
            }
            map[key] = event.calendarItemIdentifier
            keep.insert(key)
        }
        for (k, id) in map where !keep.contains(k) {
            if let e = store.calendarItem(withIdentifier: id) as? EKEvent, e.calendar?.calendarIdentifier == cal.calendarIdentifier {
                try? store.remove(e, span: .thisEvent, commit: false)
            }
            map[k] = nil
        }
        try store.commit()
        UserDefaults.standard.set(map, forKey: mapKey)
        return keep.count
    }

    /// Switched off: the Northcroft calendar and its events go.
    static func remove() {
        if let c = try? calendar(create: false) { try? store.removeCalendar(c, commit: true) }
        UserDefaults.standard.removeObject(forKey: calendarKey)
        UserDefaults.standard.removeObject(forKey: mapKey)
    }
}
