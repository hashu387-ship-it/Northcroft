import ActivityKit
import WidgetKit
import SwiftUI

// The workday Live Activity, from check-in until check-out (or midnight): on the lock screen and
// in the Dynamic Island, with the time since check-in counting up and a Check out button. The app
// starts, updates and ends it (WorkdayActivity.swift in native/northcroft-native).

/// Must stay field for field the same as WorkdayAttributes in native/northcroft-native.
struct WorkdayAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var checkInAt: Date
        var place: String?
        var dueToday: Int
        var late: Int
    }

    var firstName: String
}

private enum WorkdayLinks {
    static let checkout = URL(string: "northcroft://action/checkout")!
    static let attendance = URL(string: "northcroft://open/attendance")!
    static let tasks = URL(string: "northcroft://action/tasks")!
}

private extension WorkdayAttributes.ContentState {
    var since: ClosedRange<Date> { checkInAt...Date.distantFuture }

    var inAt: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Riyadh") ?? .current
        f.dateFormat = "h:mm a"
        return f.string(from: checkInAt)
    }

    var dueLine: String {
        if dueToday == 0 && late == 0 { return "Nothing due today" }
        return late > 0 ? "\(dueToday) due today · \(late) late" : "\(dueToday) due today"
    }
}

/// A capsule button in Northcroft red: Liquid Glass on iOS 26 and later.
private struct GlassButtonLabel: View {
    let title: String
    let symbol: String

    var body: some View {
        let label = Label(title, systemImage: symbol)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
        if #available(iOS 26.0, *) {
            label.glassEffect(.regular.tint(Color(red: 0.91, green: 0.17, blue: 0.20).opacity(0.75)), in: Capsule())
        } else {
            label.background(Color(red: 0.91, green: 0.17, blue: 0.20), in: Capsule())
        }
    }
}

private struct WorkdayLockScreen: View {
    let state: WorkdayAttributes.ContentState

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("NORTHCROFT")
                    .font(.system(size: 10, weight: .bold))
                    .kerning(1.2)
                    .foregroundStyle(Color(red: 1, green: 0.42, blue: 0.45))
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Color(red: 0.20, green: 0.78, blue: 0.45))
                    Text("In since \(state.inAt)")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                }
                if let place = state.place {
                    Text(place)
                        .font(.system(size: 12))
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(1)
                }
                Text(state.dueLine)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(state.late > 0 ? Color(red: 1, green: 0.45, blue: 0.47) : .white.opacity(0.85))
                    .contentTransition(.numericText())
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 8) {
                Text(timerInterval: state.since, countsDown: false)
                    .font(.system(size: 26, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 120, alignment: .trailing)
                Link(destination: WorkdayLinks.checkout) {
                    GlassButtonLabel(title: "Check out", symbol: "figure.walk.departure")
                }
            }
        }
        .padding(16)
    }
}

struct WorkdayLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkdayAttributes.self) { context in
            WorkdayLockScreen(state: context.state)
                .activityBackgroundTint(Color(red: 7 / 255, green: 23 / 255, blue: 51 / 255).opacity(0.55))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(WorkdayLinks.attendance)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label {
                        Text("In \(context.state.inAt)").font(.system(size: 14, weight: .semibold))
                    } icon: {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(Color(red: 0.20, green: 0.78, blue: 0.45))
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: context.state.since, countsDown: false)
                        .font(.system(size: 18, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 90, alignment: .trailing)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            if let place = context.state.place {
                                Text(place).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Link(destination: WorkdayLinks.tasks) {
                                Text(context.state.dueLine)
                                    .font(.system(size: 13, weight: .medium))
                                    .contentTransition(.numericText())
                            }
                        }
                        Spacer()
                        Link(destination: WorkdayLinks.checkout) {
                            GlassButtonLabel(title: "Check out", symbol: "figure.walk.departure")
                        }
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Color(red: 0.20, green: 0.78, blue: 0.45))
            } compactTrailing: {
                Text(timerInterval: context.state.since, countsDown: false)
                    .monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 52)
            } minimal: {
                Image(systemName: "briefcase.fill")
                    .foregroundStyle(Color(red: 0.20, green: 0.78, blue: 0.45))
            }
            .widgetURL(WorkdayLinks.attendance)
            .keylineTint(Color(red: 0.91, green: 0.17, blue: 0.20))
        }
    }
}
