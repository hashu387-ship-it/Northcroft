import Foundation
import CoreLocation
import UserNotifications

/// The site visit log: the phone notices arriving at and leaving project sites (the sites in
/// Settings > Places), even with the app closed, the same way it notices arriving at the office.
/// It doesn't follow the person around: iOS only says when the phone crosses a site's circle.
/// Arrivals and departures wait in SiteVisits until the web app takes them (siteTake) and saves
/// them to the site_visits table, because saving needs the person's sign-in.
public final class SiteWatcher: NSObject, CLLocationManagerDelegate {
    public static let shared = SiteWatcher()

    private let manager = CLLocationManager()
    private let defaults = UserDefaults.standard
    private let prefix = "nc-site-"
    private let namesKey = "nc-site-names"
    /// iOS watches at most 20 circles per app; the office watcher uses up to 10.
    private let maxSites = 8

    struct Site {
        let id: String
        let name: String
        let lat: Double
        let lng: Double
        let radius: Double
        let projectId: String?
    }

    private override init() {
        super.init()
        manager.delegate = self
    }

    /// Called at launch so arrivals reach this object even when iOS starts the app in the background.
    public func activate() {}

    var watching: Bool {
        manager.monitoredRegions.contains { $0.identifier.hasPrefix(prefix) }
    }

    /// Watches the nearest sites (replacing any watched before). Returns how many.
    func watch(_ sites: [Site]) -> Int {
        stop()
        guard CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else { return 0 }
        var list = sites
        if let here = manager.location {
            list.sort {
                here.distance(from: CLLocation(latitude: $0.lat, longitude: $0.lng)) < here.distance(from: CLLocation(latitude: $1.lat, longitude: $1.lng))
            }
        }
        var saved: [String: [String: String]] = [:]
        for s in list.prefix(maxSites) {
            let id = prefix + s.id
            let radius = min(max(s.radius, 150), manager.maximumRegionMonitoringDistance)
            let region = CLCircularRegion(center: CLLocationCoordinate2D(latitude: s.lat, longitude: s.lng), radius: radius, identifier: id)
            region.notifyOnEntry = true
            region.notifyOnExit = true
            manager.startMonitoring(for: region)
            saved[id] = ["id": s.id, "name": s.name, "project": s.projectId ?? ""]
        }
        defaults.set(saved, forKey: namesKey)
        return min(list.count, maxSites)
    }

    func stop() {
        for r in manager.monitoredRegions where r.identifier.hasPrefix(prefix) {
            manager.stopMonitoring(for: r)
        }
    }

    public func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        record(region, kind: "arrive")
    }

    public func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        record(region, kind: "leave")
    }

    public func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
        guard region?.identifier.hasPrefix(prefix) == true else { return }
        NSLog("Northcroft site watch failed: \(error.localizedDescription)")
    }

    private func record(_ region: CLRegion, kind: String) {
        guard region.identifier.hasPrefix(prefix) else { return }
        let saved = (defaults.dictionary(forKey: namesKey) as? [String: [String: String]]) ?? [:]
        let info = saved[region.identifier] ?? [:]
        let id = info["id"] ?? String(region.identifier.dropFirst(prefix.count))
        let name = info["name"] ?? "Site"
        let project = info["project"].flatMap { $0.isEmpty ? nil : $0 }
        SiteVisits.add(kind: kind, placeId: id, name: name, projectId: project, source: "gps")

        // A quiet note on arrival (it goes to the notification list without lighting up the phone).
        guard kind == "arrive" else { return }
        let content = UNMutableNotificationContent()
        content.title = "At \(name)"
        content.body = "Site visit logged."
        content.userInfo = ["url": "/attendance"]
        if #available(iOS 15.0, *) { content.interruptionLevel = .passive }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "nc-site-\(id)", content: content, trigger: nil), withCompletionHandler: nil)
    }
}

/// Arrivals at and departures from sites, waiting for the web app to save them.
enum SiteVisits {
    private static let key = "nc-site-events"

    static func add(kind: String, placeId: String, name: String, projectId: String?, source: String) {
        var list = (UserDefaults.standard.array(forKey: key) as? [[String: Any]]) ?? []
        var e: [String: Any] = ["kind": kind, "placeId": placeId, "name": name, "atMs": Date().timeIntervalSince1970 * 1000, "source": source]
        if let p = projectId { e["projectId"] = p }
        list.append(e)
        UserDefaults.standard.set(Array(list.suffix(200)), forKey: key)
    }

    static func take() -> [[String: Any]] {
        let list = (UserDefaults.standard.array(forKey: key) as? [[String: Any]]) ?? []
        UserDefaults.standard.removeObject(forKey: key)
        return list
    }
}
