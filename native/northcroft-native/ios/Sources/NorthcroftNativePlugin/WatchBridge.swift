import Foundation
import UIKit
import UserNotifications
import WatchConnectivity

/// The link to Northcroft on the Apple Watch (ios/App/NorthcroftWatch): sends it the same copy of
/// today's check-in and tasks the widget shows, and takes its Check in button, which needs the
/// iPhone (sign-in and location). If Northcroft isn't open, a notification asks to tap to finish.
final class WatchBridge: NSObject, WCSessionDelegate {
    static let shared = WatchBridge()

    /// The latest copy, sent once the watch link is ready (nil: signed out).
    private var latest: Data?
    private var hasLatest = false

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// Sends the copy (JSON) to the watch, or tells it they've signed out (nil).
    func send(_ snapshot: Data?) {
        DispatchQueue.main.async {
            self.latest = snapshot
            self.hasLatest = true
            self.push()
        }
    }

    private func push() {
        guard hasLatest, WCSession.isSupported() else { return }
        let s = WCSession.default
        guard s.activationState == .activated, s.isPaired, s.isWatchAppInstalled else { return }
        let context: [String: Any] = latest.map { ["snapshot": $0, "at": Date().timeIntervalSince1970] } ?? ["signedOut": true]
        try? s.updateApplicationContext(context)
    }

    // MARK: WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if activationState == .activated { DispatchQueue.main.async { self.push() } }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        // Switched to another watch: link to that one.
        WCSession.default.activate()
    }

    func sessionWatchStateDidChange(_ session: WCSession) {
        DispatchQueue.main.async { self.push() }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        guard message["action"] as? String == "checkin" else {
            replyHandler(["ok": false])
            return
        }
        DispatchQueue.main.async {
            LaunchActions.set("checkin")
            if UIApplication.shared.applicationState != .active { WatchBridge.askToFinish() }
        }
        replyHandler(["ok": true])
    }

    /// "Check in: tap to finish", opening Check in (the app then checks in, see NativeBridge).
    private static func askToFinish() {
        let content = UNMutableNotificationContent()
        content.title = "Check in"
        content.body = "Tap to finish checking in from your Apple Watch."
        content.sound = .default
        content.userInfo = ["url": "/attendance"]
        let request = UNNotificationRequest(identifier: "nc-watch-checkin", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
    }
}
