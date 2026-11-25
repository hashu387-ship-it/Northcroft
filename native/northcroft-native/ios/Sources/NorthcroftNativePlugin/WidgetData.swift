import Foundation
import WidgetKit

/// What the home screen widget shows, written by the app whenever it changes (the widget can't
/// sign in, so it shows the latest copy). The widget reads the same key; see
/// ios/App/NorthcroftWidget/NorthcroftWidget.swift.
public enum WidgetData {
    public static let key = "widget.snapshot"

    /// Saves the snapshot (JSON from the web app) and asks iOS to redraw the widget.
    /// false if the shared group isn't available in this build.
    @discardableResult
    public static func save(_ json: [String: Any]) -> Bool {
        guard let defaults = AppGroup.defaults,
              JSONSerialization.isValidJSONObject(json),
              let data = try? JSONSerialization.data(withJSONObject: json) else { return false }
        if defaults.data(forKey: key) == data { return true }
        defaults.set(data, forKey: key)
        WidgetCenter.shared.reloadAllTimelines()
        return true
    }

    /// Signed out: the widget goes back to "Open Northcroft".
    public static func clear() {
        AppGroup.defaults?.removeObject(forKey: key)
        WidgetCenter.shared.reloadAllTimelines()
    }
}
