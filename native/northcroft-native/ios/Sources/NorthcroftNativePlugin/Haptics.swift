import UIKit

/// The small taps the phone gives back: "selection" for tabs and choices, "light"/"medium"/"heavy"/
/// "soft"/"rigid" for buttons, "success"/"warning"/"error" for results. The iPhone's own
/// System Haptics setting still applies.
enum Haptics {
    static func play(_ style: String) {
        DispatchQueue.main.async {
            switch style {
            case "selection":
                UISelectionFeedbackGenerator().selectionChanged()
            case "success":
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "warning":
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
            case "error":
                UINotificationFeedbackGenerator().notificationOccurred(.error)
            default:
                let s: UIImpactFeedbackGenerator.FeedbackStyle
                switch style {
                case "medium": s = .medium
                case "heavy": s = .heavy
                case "soft": s = .soft
                case "rigid": s = .rigid
                default: s = .light
                }
                UIImpactFeedbackGenerator(style: s).impactOccurred()
            }
        }
    }
}
