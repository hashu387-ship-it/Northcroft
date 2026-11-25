import Foundation
import UIKit
import ActivityKit
import AVFoundation
import CoreLocation
import EventKit
import Network
import UserNotifications

/// What the phone allows Northcroft to do, for Settings > iPhone app > This phone: location,
/// notifications (with time-sensitive and the scheduled summary), Live Activities, calendar,
/// camera, microphone, background refresh, Low Power Mode, battery and the network.
/// Nothing here asks for a permission; it only reads the current answers.
enum PhoneStatus {
    static func read(_ done: @escaping ([String: Any]) -> Void) {
        var out: [String: Any] = [:]
        let group = DispatchGroup()
        let lock = NSLock()
        func put(_ key: String, _ value: Any) {
            lock.lock()
            out[key] = value
            lock.unlock()
        }

        let lm = CLLocationManager()
        put("location", locationText(lm.authorizationStatus))
        put("preciseLocation", lm.accuracyAuthorization == .fullAccuracy)
        put("camera", avText(AVCaptureDevice.authorizationStatus(for: .video)))
        put("microphone", micText())
        put("calendar", calendarText())
        put("lowPower", ProcessInfo.processInfo.isLowPowerModeEnabled)
        if #available(iOS 16.1, *) {
            put("liveActivities", ActivityAuthorizationInfo().areActivitiesEnabled)
        }

        group.enter()
        DispatchQueue.main.async {
            switch UIApplication.shared.backgroundRefreshStatus {
            case .available: put("backgroundRefresh", "on")
            case .denied: put("backgroundRefresh", "off")
            case .restricted: put("backgroundRefresh", "restricted")
            @unknown default: put("backgroundRefresh", "unknown")
            }
            let device = UIDevice.current
            let was = device.isBatteryMonitoringEnabled
            device.isBatteryMonitoringEnabled = true
            if device.batteryLevel >= 0 { put("battery", Int((device.batteryLevel * 100).rounded())) }
            switch device.batteryState {
            case .charging: put("batteryState", "charging")
            case .full: put("batteryState", "full")
            case .unplugged: put("batteryState", "unplugged")
            default: break
            }
            device.isBatteryMonitoringEnabled = was
            put("device", device.model)
            put("system", "\(device.systemName) \(device.systemVersion)")
            group.leave()
        }

        group.enter()
        DispatchQueue.global(qos: .userInitiated).async {
            put("locationServices", CLLocationManager.locationServicesEnabled())
            group.leave()
        }

        group.enter()
        UNUserNotificationCenter.current().getNotificationSettings { s in
            switch s.authorizationStatus {
            case .authorized: put("notifications", "on")
            case .provisional: put("notifications", "quiet")
            case .ephemeral: put("notifications", "on")
            case .denied: put("notifications", "off")
            case .notDetermined: put("notifications", "notAsked")
            @unknown default: put("notifications", "unknown")
            }
            put("notificationAlerts", s.alertSetting == .enabled)
            put("notificationSounds", s.soundSetting == .enabled)
            put("lockScreen", s.lockScreenSetting == .enabled)
            if #available(iOS 15.0, *) {
                put("timeSensitive", s.timeSensitiveSetting == .enabled)
                put("summary", s.scheduledDeliverySetting == .enabled)
            }
            group.leave()
        }

        group.enter()
        let monitor = NWPathMonitor()
        var answered = false
        monitor.pathUpdateHandler = { path in
            lock.lock()
            let first = !answered
            answered = true
            lock.unlock()
            guard first else { return }
            put("online", path.status == .satisfied)
            put("network", path.usesInterfaceType(.wifi) ? "wifi" : path.usesInterfaceType(.cellular) ? "cellular" : path.usesInterfaceType(.wiredEthernet) ? "wired" : "none")
            put("lowData", path.isConstrained)
            monitor.cancel()
            group.leave()
        }
        monitor.start(queue: DispatchQueue.global(qos: .utility))

        group.notify(queue: .main) { done(out) }
    }

    /// Opens Northcroft's page in the Settings app (or its notifications page).
    static func openSettings(_ kind: String?) {
        DispatchQueue.main.async {
            var link = UIApplication.openSettingsURLString
            if kind == "notifications", #available(iOS 16.0, *) { link = UIApplication.openNotificationSettingsURLString }
            if let url = URL(string: link) { UIApplication.shared.open(url) }
        }
    }

    private static func locationText(_ s: CLAuthorizationStatus) -> String {
        switch s {
        case .authorizedAlways: return "always"
        case .authorizedWhenInUse: return "whenInUse"
        case .denied: return "off"
        case .restricted: return "restricted"
        case .notDetermined: return "notAsked"
        @unknown default: return "unknown"
        }
    }

    private static func avText(_ s: AVAuthorizationStatus) -> String {
        switch s {
        case .authorized: return "on"
        case .denied: return "off"
        case .restricted: return "restricted"
        case .notDetermined: return "notAsked"
        @unknown default: return "unknown"
        }
    }

    private static func micText() -> String {
        if #available(iOS 17.0, *) {
            switch AVAudioApplication.shared.recordPermission {
            case .granted: return "on"
            case .denied: return "off"
            case .undetermined: return "notAsked"
            @unknown default: return "unknown"
            }
        }
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted: return "on"
        case .denied: return "off"
        case .undetermined: return "notAsked"
        @unknown default: return "unknown"
        }
    }

    private static func calendarText() -> String {
        let s = EKEventStore.authorizationStatus(for: .event)
        if #available(iOS 17.0, *) {
            switch s {
            case .fullAccess: return "on"
            case .writeOnly: return "addOnly"
            case .denied: return "off"
            case .restricted: return "restricted"
            case .notDetermined: return "notAsked"
            default: return "unknown"
            }
        }
        switch s {
        case .denied: return "off"
        case .restricted: return "restricted"
        case .notDetermined: return "notAsked"
        default: return "on"
        }
    }
}

/// The phone side of a Northcroft voice call (the call itself runs in the web view):
/// earpiece or loudspeaker, Bluetooth headsets and AirPods, the screen turning off against the
/// ear, and the phone not locking mid-call.
enum CallAudio {
    static func set(active: Bool, speaker: Bool) {
        DispatchQueue.main.async {
            let s = AVAudioSession.sharedInstance()
            if active {
                var options: AVAudioSession.CategoryOptions = [.allowBluetooth]
                if speaker { options.insert(.defaultToSpeaker) }
                try? s.setCategory(.playAndRecord, mode: .voiceChat, options: options)
                try? s.setActive(true)
                try? s.overrideOutputAudioPort(speaker ? .speaker : .none)
                UIDevice.current.isProximityMonitoringEnabled = !speaker
                UIApplication.shared.isIdleTimerDisabled = true
            } else {
                try? s.overrideOutputAudioPort(.none)
                UIDevice.current.isProximityMonitoringEnabled = false
                UIApplication.shared.isIdleTimerDisabled = false
            }
        }
    }

    /// Where the sound is going now: "speaker", "bluetooth", "headphones" or "phone".
    static var route: String {
        let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
        for o in outputs {
            switch o.portType {
            case .builtInSpeaker: return "speaker"
            case .bluetoothHFP, .bluetoothA2DP, .bluetoothLE: return "bluetooth"
            case .headphones, .usbAudio, .carAudio: return "headphones"
            default: continue
            }
        }
        return "phone"
    }
}
