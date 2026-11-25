import ActivityKit
import WidgetKit
import SwiftUI

// A trip to a project site, like a delivery on its way: the distance left, a car moving along a
// bar as it gets closer, the arrival time from Apple Maps, and End trip. It turns to "Arrived"
// on arrival. The app runs it (SiteTrip.swift in native/northcroft-native).

/// Must stay field for field the same as TripAttributes in native/northcroft-native.
struct TripAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var distanceM: Double
        var startDistanceM: Double
        var etaAt: Date?
        var arrived: Bool
    }

    var placeName: String
    var placeId: String
    var startedAt: Date
}

private enum TripLinks {
    static let end = URL(string: "northcroft://action/endtrip")!
    static let attendance = URL(string: "northcroft://open/attendance")!
}

private extension TripAttributes.ContentState {
    var located: Bool { distanceM >= 0 }
    var fraction: Double {
        if arrived { return 1 }
        guard located, startDistanceM > 0 else { return 0 }
        return min(max(1 - distanceM / startDistanceM, 0), 1)
    }
    var distanceText: String {
        if arrived { return "Arrived" }
        guard located else { return "Finding you…" }
        if distanceM < 1000 { return "\(Int((distanceM / 10).rounded()) * 10) m to go" }
        return String(format: "%.1f km to go", distanceM / 1000)
    }
}

/// The bar with the car on it.
private struct TripTrack: View {
    let fraction: Double
    let arrived: Bool

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let x = max(12, min(w - 12, w * fraction))
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.2)).frame(height: 6)
                Capsule().fill(arrived ? NC.green : NC.blue).frame(width: x, height: 6)
                Image(systemName: arrived ? "flag.checkered.circle.fill" : "car.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 26, height: 26)
                    .background(arrived ? NC.green : NC.blue, in: Circle())
                    .offset(x: x - 13)
                HStack {
                    Spacer()
                    Image(systemName: "mappin.circle.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(arrived ? NC.green : .white.opacity(0.8))
                }
            }
            .frame(height: 26)
            .frame(maxHeight: .infinity, alignment: .center)
        }
        .frame(height: 28)
    }
}

private struct TripLockScreen: View {
    let attrs: TripAttributes
    let state: TripAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    NCEyebrow(text: "Northcroft · Site trip", tint: state.arrived ? NC.green : NC.softRed)
                    Text(state.arrived ? "At \(attrs.placeName)" : "To \(attrs.placeName)")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Text(state.distanceText)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.white.opacity(0.75))
                        .contentTransition(.numericText())
                }
                Spacer(minLength: 8)
                if let eta = state.etaAt, !state.arrived {
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(NC.time(eta))
                            .font(.system(size: 24, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(.white)
                            .contentTransition(.numericText())
                        Text("arrival")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(.white.opacity(0.6))
                    }
                } else if state.arrived {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(NC.green)
                }
            }

            TripTrack(fraction: state.fraction, arrived: state.arrived)
                .ncGlassPanel()

            HStack {
                Text(state.arrived ? "Visit logged on the Check in page" : "On the way since \(NC.time(attrs.startedAt))")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white.opacity(0.7))
                Spacer(minLength: 6)
                if !state.arrived {
                    Link(destination: TripLinks.end) {
                        NCGlassButton(title: "End trip", symbol: "xmark", tint: NC.red)
                    }
                }
            }
        }
        .padding(16)
    }
}

struct TripLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TripAttributes.self) { context in
            TripLockScreen(attrs: context.attributes, state: context.state)
                .activityBackgroundTint(NC.navy.opacity(0.55))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(TripLinks.attendance)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: context.state.arrived ? "checkmark.circle.fill" : "car.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(context.state.arrived ? NC.green : NC.blue)
                        .padding(.leading, 6)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let eta = context.state.etaAt, !context.state.arrived {
                        Text(NC.time(eta))
                            .font(.system(size: 16, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                            .padding(.trailing, 6)
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 1) {
                        Text(context.attributes.placeName)
                            .font(.system(size: 14, weight: .semibold))
                            .lineLimit(1)
                        Text(context.state.distanceText)
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    TripTrack(fraction: context.state.fraction, arrived: context.state.arrived)
                        .padding(.horizontal, 8)
                }
            } compactLeading: {
                Image(systemName: context.state.arrived ? "checkmark.circle.fill" : "car.fill")
                    .foregroundStyle(context.state.arrived ? NC.green : NC.blue)
            } compactTrailing: {
                if let eta = context.state.etaAt, !context.state.arrived {
                    Text(NC.time(eta))
                        .font(.system(size: 12, weight: .semibold))
                        .monospacedDigit()
                } else {
                    Text(context.state.arrived ? "Here" : "…")
                        .font(.system(size: 12, weight: .semibold))
                }
            } minimal: {
                Image(systemName: context.state.arrived ? "checkmark.circle.fill" : "car.fill")
                    .foregroundStyle(context.state.arrived ? NC.green : NC.blue)
            }
            .widgetURL(TripLinks.attendance)
            .keylineTint(NC.blue)
        }
    }
}
