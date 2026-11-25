import Foundation
import ActivityKit
import CoreLocation
import MapKit
import UserNotifications

/// A trip to a project site, like a delivery on its way: the Live Activity shows how far there is
/// to go, a bar filling up as the distance shrinks, and the arrival time from Apple Maps. It ends
/// on its own on arrival (and the arrival goes into the site visit log), or with End trip.
/// The phone's location is only used while a trip is running; the blue pill at the top of the
/// screen shows when that is.
/// The widget extension draws it (ios/App/NorthcroftWidget/TripLiveActivity.swift), with its own
/// copy of these attributes: the two must stay field for field the same.
public struct TripAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Straight-line distance left, in metres (-1 until the first location fix).
        public var distanceM: Double
        /// The distance at the start, for the bar.
        public var startDistanceM: Double
        /// When Apple Maps expects arrival by car.
        public var etaAt: Date?
        public var arrived: Bool
    }

    public var placeName: String
    public var placeId: String
    public var startedAt: Date
}

public final class SiteTrip: NSObject, CLLocationManagerDelegate {
    public static let shared = SiteTrip()

    struct Target {
        let id: String
        let name: String
        let location: CLLocation
        let radius: Double
        let projectId: String?
    }

    private let manager = CLLocationManager()
    private var target: Target?
    private var startedAt = Date()
    private var startDistance: Double = -1
    private var etaAt: Date?
    private var lastEtaAsk: Date = .distantPast
    private var lastEtaFrom: CLLocation?
    private var lastSent: (at: Date, distance: Double) = (.distantPast, -1)

    private override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 40
        manager.activityType = .automotiveNavigation
        manager.pausesLocationUpdatesAutomatically = false
    }

    var running: [String: Any]? {
        guard let t = target else { return nil }
        return ["placeId": t.id, "placeName": t.name, "startedAtMs": startedAt.timeIntervalSince1970 * 1000]
    }

    /// Starts a trip (replacing one already running). done gets nil, or why it couldn't start.
    func start(id: String, name: String, lat: Double, lng: Double, radius: Double, projectId: String?, done: @escaping (String?) -> Void) {
        switch manager.authorizationStatus {
        case .denied, .restricted:
            done("location-off")
            return
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        default:
            break
        }
        stop(silently: true)
        target = Target(id: id, name: name, location: CLLocation(latitude: lat, longitude: lng), radius: max(radius, 80), projectId: projectId)
        startedAt = Date()
        startDistance = -1
        etaAt = nil
        lastEtaAsk = .distantPast
        lastEtaFrom = nil
        lastSent = (.distantPast, -1)
        // Keeps going with the phone locked or another app open (the "location" background mode).
        if let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String], modes.contains("location") {
            manager.allowsBackgroundLocationUpdates = true
            manager.showsBackgroundLocationIndicator = true
        }
        manager.startUpdatingLocation()
        if #available(iOS 16.2, *) {
            Task { await self.startActivity() }
        }
        if let here = manager.location, here.timestamp.timeIntervalSinceNow > -120 { handle(here) }
        done(nil)
    }

    /// Ends the trip (End trip on the lock screen, or in the app).
    public func stop(silently: Bool = false) {
        guard target != nil else { return }
        target = nil
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        if #available(iOS 16.2, *) {
            Task {
                for a in Activity<TripAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
            }
        }
    }

    // MARK: - Location

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let here = locations.last, here.horizontalAccuracy >= 0, here.horizontalAccuracy < 1000 else { return }
        handle(here)
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        NSLog("Northcroft trip location: \(error.localizedDescription)")
    }

    private func handle(_ here: CLLocation) {
        guard let t = target else { return }
        let distance = here.distance(from: t.location)
        if startDistance < 0 { startDistance = max(distance, 1) }

        if distance <= t.radius + 40 {
            arrive(t)
            return
        }
        askEta(from: here, to: t)
        // Update the lock screen when it has moved on a little, or once a minute.
        if abs(distance - lastSent.distance) >= 80 || Date().timeIntervalSince(lastSent.at) >= 60 {
            lastSent = (Date(), distance)
            send(distance: distance, arrived: false)
        }
    }

    private func askEta(from here: CLLocation, to t: Target) {
        let moved = lastEtaFrom.map { here.distance(from: $0) } ?? .infinity
        guard Date().timeIntervalSince(lastEtaAsk) >= 120 || moved >= 1500 else { return }
        lastEtaAsk = Date()
        lastEtaFrom = here
        let request = MKDirections.Request()
        request.source = MKMapItem(placemark: MKPlacemark(coordinate: here.coordinate))
        request.destination = MKMapItem(placemark: MKPlacemark(coordinate: t.location.coordinate))
        request.transportType = .automobile
        MKDirections(request: request).calculateETA { [weak self] response, _ in
            guard let self, let seconds = response?.expectedTravelTime, self.target?.id == t.id else { return }
            DispatchQueue.main.async {
                self.etaAt = Date().addingTimeInterval(seconds)
                self.send(distance: self.lastSent.distance >= 0 ? self.lastSent.distance : here.distance(from: t.location), arrived: false)
            }
        }
    }

    private func arrive(_ t: Target) {
        target = nil
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        SiteVisits.add(kind: "arrive", placeId: t.id, name: t.name, projectId: t.projectId, source: "trip")
        send(distance: 0, arrived: true)

        let content = UNMutableNotificationContent()
        content.title = "You've arrived at \(t.name)"
        content.body = "The visit is in your site visit log."
        content.sound = .default
        content.userInfo = ["url": "/attendance"]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "nc-trip-arrived", content: content, trigger: nil), withCompletionHandler: nil)
    }

    // MARK: - Live Activity

    @available(iOS 16.2, *)
    private func startActivity() async {
        guard let t = target, ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        for a in Activity<TripAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
        let state = TripAttributes.ContentState(distanceM: -1, startDistanceM: -1, etaAt: nil, arrived: false)
        _ = try? Activity.request(
            attributes: TripAttributes(placeName: t.name, placeId: t.id, startedAt: startedAt),
            content: ActivityContent(state: state, staleDate: Date().addingTimeInterval(30 * 60)),
            pushType: nil)
    }

    private func send(distance: Double, arrived: Bool) {
        guard #available(iOS 16.2, *) else { return }
        let state = TripAttributes.ContentState(distanceM: distance, startDistanceM: startDistance, etaAt: arrived ? nil : etaAt, arrived: arrived)
        Task {
            for a in Activity<TripAttributes>.activities {
                if arrived {
                    await a.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(20 * 60)))
                } else {
                    await a.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(30 * 60)))
                }
            }
        }
    }
}
