import ActivityKit
import WidgetKit
import SwiftUI

// The workday Live Activity, from check-in until check-out (or midnight): on the lock screen and
// in the Dynamic Island, delivery-app style: a bar filling from check-in to the end of office
// hours, the time left, the time since check-in and a Check out button. The app starts, updates
// and ends it (WorkdayActivity.swift in native/northcroft-native).

/// Must stay field for field the same as WorkdayAttributes in native/northcroft-native.
struct WorkdayAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var checkInAt: Date
        var place: String?
        var dueToday: Int
        var late: Int
        var endAt: Date?
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

private struct WorkdayLockScreen: View {
    let state: WorkdayAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    NCEyebrow(text: "Northcroft · Workday")
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(NC.green)
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
                }
                Spacer(minLength: 8)
                Text(timerInterval: state.since, countsDown: false)
                    .font(.system(size: 26, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 120, alignment: .trailing)
            }

            if let end = state.endAt, end > state.checkInAt {
                // Like a delivery on its way: the day filling up to the end of office hours.
                VStack(alignment: .leading, spacing: 5) {
                    ProgressView(timerInterval: state.checkInAt...end, countsDown: false) {
                        EmptyView()
                    } currentValueLabel: {
                        EmptyView()
                    }
                    .progressViewStyle(.linear)
                    .tint(NC.green)
                    HStack(spacing: 4) {
                        Text("Office hours end \(NC.time(end))")
                        Spacer(minLength: 4)
                        Text(timerInterval: Date()...max(end, Date()), countsDown: true)
                            .monospacedDigit()
                            .multilineTextAlignment(.trailing)
                            .frame(maxWidth: 70, alignment: .trailing)
                        Text("left")
                    }
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white.opacity(0.75))
                }
                .ncGlassPanel()
            }

            HStack {
                Text(state.dueLine)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(state.late > 0 ? NC.softRed : .white.opacity(0.85))
                    .contentTransition(.numericText())
                Spacer(minLength: 8)
                Link(destination: WorkdayLinks.checkout) {
                    NCGlassButton(title: "Check out", symbol: "figure.walk.departure")
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
                .activityBackgroundTint(NC.navy.opacity(0.55))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(WorkdayLinks.attendance)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label {
                        Text("In \(context.state.inAt)").font(.system(size: 14, weight: .semibold))
                    } icon: {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(NC.green)
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
                    VStack(spacing: 8) {
                    if let end = context.state.endAt, end > context.state.checkInAt {
                        ProgressView(timerInterval: context.state.checkInAt...end, countsDown: false) {
                            EmptyView()
                        } currentValueLabel: {
                            EmptyView()
                        }
                        .progressViewStyle(.linear)
                        .tint(NC.green)
                        .padding(.horizontal, 4)
                    }
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
                            NCGlassButton(title: "Check out", symbol: "figure.walk.departure")
                        }
                    }
                    .padding(.horizontal, 4)
                    }
                }
            } compactLeading: {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(NC.green)
            } compactTrailing: {
                Text(timerInterval: context.state.since, countsDown: false)
                    .monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 52)
            } minimal: {
                Image(systemName: "briefcase.fill")
                    .foregroundStyle(NC.green)
            }
            .widgetURL(WorkdayLinks.attendance)
            .keylineTint(NC.red)
        }
    }
}
