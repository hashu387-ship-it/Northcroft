import Foundation
import CoreLocation
import UserNotifications

/// Notices when someone arrives at the office, even with the app closed, and shows
/// "You're at the office. Tap to check in." Tapping it opens the app, which checks in with the
/// phone's location as usual (the office-only rule still applies).
///
/// It uses iOS region monitoring: the phone itself watches for crossing into the office area, so
/// nothing is tracked and the battery cost is close to nothing. The app tells it where the
/// offices are, the working days, and when the person has already checked in today.
public final class OfficeWatcher: NSObject, CLLocationManagerDelegate {
    public static let shared = OfficeWatcher()

    private let manager = CLLocationManager()
    private let defaults = UserDefaults.standard
    private let regionPrefix = "nc-office-"
    private var waiters: [(String) -> Void] = []

    private enum Key {
        static let names = "nc-office-names"
        static let workDays = "nc-office-workdays"
        static let checkedIn = "nc-office-checked-in"
        static let notified = "nc-office-notified"
        static let pending = "nc-office-pending"
    }

    private override init() {
        super.init()
        manager.delegate = self
    }

    /// Called at launch so arrivals reach this object even when iOS starts the app in the background.
    public func activate() {}

    // MARK: - Permission

    var status: String {
        switch manager.authorizationStatus {
        case .authorizedAlways: return "always"
        case .authorizedWhenInUse: return "whenInUse"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "unknown"
        }
    }

    /// Asks for "Always" (needed to notice arrivals with the app closed). iOS first offers
    /// "While Using", then later asks the person to allow it always.
    func requestAlways(_ done: @escaping (String) -> Void) {
        let s = manager.authorizationStatus
        if s == .authorizedAlways || s == .denied || s == .restricted {
            done(status)
            return
        }
        waiters.append(done)
        manager.requestAlwaysAuthorization()
        // If the person closes the question without changing anything, answer anyway.
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in self?.answerWaiters() }
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus != .notDetermined { answerWaiters() }
    }

    private func answerWaiters() {
        let list = waiters
        waiters.removeAll()
        list.forEach { $0(status) }
    }

    // MARK: - Offices

    struct Office {
        let id: String
        let name: String
        let lat: Double
        let lng: Double
        let radius: Double
    }

    /// Watches these offices (replacing any watched before). Work days: 0 = Sunday.
    func watch(_ offices: [Office], workDays: [Int]) {
        stop()
        guard CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else { return }
        var names: [String: String] = [:]
        for o in offices.prefix(10) {
            let id = regionPrefix + o.id
            // iOS needs a reasonably large circle to notice arrivals reliably.
            let radius = min(max(o.radius, 150), manager.maximumRegionMonitoringDistance)
            let region = CLCircularRegion(center: CLLocationCoordinate2D(latitude: o.lat, longitude: o.lng), radius: radius, identifier: id)
            region.notifyOnEntry = true
            region.notifyOnExit = false
            manager.startMonitoring(for: region)
            names[id] = o.name
        }
        defaults.set(names, forKey: Key.names)
        defaults.set(workDays, forKey: Key.workDays)
    }

    func stop() {
        for r in manager.monitoredRegions where r.identifier.hasPrefix(regionPrefix) {
            manager.stopMonitoring(for: r)
        }
        defaults.removeObject(forKey: Key.names)
    }

    var watching: Bool {
        manager.monitoredRegions.contains { $0.identifier.hasPrefix(regionPrefix) }
    }

    /// The person checked in today: no arrival notice for the rest of the day.
    func markCheckedIn(day: String) {
        defaults.set(day, forKey: Key.checkedIn)
        defaults.removeObject(forKey: Key.pending)
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["nc-office-arrive"])
    }

    /// An arrival from the last three hours today that hasn't been acted on, if any.
    func takePending() -> [String: String]? {
        guard let p = defaults.dictionary(forKey: Key.pending) as? [String: String] else { return nil }
        defaults.removeObject(forKey: Key.pending)
        guard p["day"] == OfficeWatcher.today(), let at = p["at"], let when = ISO8601DateFormatter().date(from: at),
              Date().timeIntervalSince(when) < 3 * 3600 else { return nil }
        return p
    }

    // MARK: - Arrivals

    public func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        guard region.identifier.hasPrefix(regionPrefix) else { return }
        let now = Date()
        let day = OfficeWatcher.today()
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = OfficeWatcher.zone
        let weekday = cal.component(.weekday, from: now) - 1
        let hour = cal.component(.hour, from: now)
        let workDays = (defaults.array(forKey: Key.workDays) as? [Int]) ?? [0, 1, 2, 3, 4]
        guard workDays.contains(weekday), hour >= 5, hour < 16 else { return }
        guard defaults.string(forKey: Key.checkedIn) != day, defaults.string(forKey: Key.notified) != day else { return }
        defaults.set(day, forKey: Key.notified)

        let names = (defaults.dictionary(forKey: Key.names) as? [String: String]) ?? [:]
        let place = names[region.identifier] ?? "the office"
        defaults.set(["kind": "in", "at": ISO8601DateFormatter().string(from: now), "place": place, "day": day], forKey: Key.pending)

        let content = UNMutableNotificationContent()
        content.title = "You're at \(place)"
        content.body = "Tap to check in."
        content.sound = .default
        content.userInfo = ["nc": "office-in"]
        let request = UNNotificationRequest(identifier: "nc-office-arrive", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
    }

    public func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
        NSLog("Northcroft office watch failed: \(error.localizedDescription)")
    }

    // MARK: - Dates (office time)

    static let zone = TimeZone(identifier: "Asia/Riyadh") ?? .current

    static func today() -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = zone
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }
}
