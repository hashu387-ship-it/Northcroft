import Foundation

/// The shared folder and settings the app, the share extension and the widget all use.
/// Its name comes from the NCAppGroup key in each Info.plist, which Xcode fills from the
/// NC_APP_GROUP build setting, so a test build can use a different group from the App Store one.
public enum AppGroup {
    public static var id: String {
        if let v = Bundle.main.object(forInfoDictionaryKey: "NCAppGroup") as? String,
           !v.isEmpty, !v.contains("$(") {
            return v
        }
        return "group.com.northcroftme.qsteam"
    }

    /// Settings shared with the widget. nil if the group isn't set up for this build.
    public static var defaults: UserDefaults? {
        UserDefaults(suiteName: id)
    }
}
