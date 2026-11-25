import AppIntents
import SwiftUI
import WidgetKit

// Control Center and lock screen buttons (iOS 18 and later): Check in and Scan a document. Add them
// from Control Center's edit mode, or put one on the lock screen instead of the torch or camera.
// Each opens Northcroft to do it (Shared/NorthcroftActionIntents.swift).

@available(iOS 18.0, *)
struct CheckInControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "northcroft.control.checkin") {
            ControlWidgetButton(action: CheckInIntent()) {
                Label("Check in", systemImage: "mappin.and.ellipse")
            }
        }
        .displayName("Check in")
        .description("Opens Northcroft and checks you in at the office.")
    }
}

@available(iOS 18.0, *)
struct ScanControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "northcroft.control.scan") {
            ControlWidgetButton(action: ScanDocumentIntent()) {
                Label("Scan to Northcroft", systemImage: "doc.viewfinder")
            }
        }
        .displayName("Scan a document")
        .description("Opens Northcroft's document scanner.")
    }
}
