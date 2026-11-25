import ActivityKit
import WidgetKit
import SwiftUI

// A task on the lock screen and in the Dynamic Island, like an order on its way: the stages it
// goes through with the current one lit, a countdown to the deadline (red once it's late), what's
// happening now, and an Open task button. The app starts, updates and ends it (TaskActivity.swift
// in native/northcroft-native).

/// Must stay field for field the same as TaskAttributes in native/northcroft-native.
struct TaskAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var stage: Int
        var stages: [String]
        var status: String
        var person: String?
        var dueAt: Date?
        var progress: Int?
        var held: Bool
        var done: Bool
    }

    var taskId: String
    var title: String
    var project: String?
    var role: String
}

private extension TaskAttributes {
    var link: URL { URL(string: "northcroft://open/tasks/\(taskId)")! }
    var eyebrow: String { role == "given" ? "Northcroft · Task you gave" : "Northcroft · Your task" }
}

private extension TaskAttributes.ContentState {
    var tint: Color { done ? NC.green : held ? NC.amber : NC.blue }
    var symbol: String {
        if done { return "checkmark.seal.fill" }
        if held { return "pause.circle.fill" }
        switch stage {
        case 0: return "tray.and.arrow.down.fill"
        case 1: return "hammer.fill"
        default: return "paperplane.fill"
        }
    }
    var dueSoon: Bool {
        guard let due = dueAt else { return false }
        return due.timeIntervalSinceNow > 0 && due.timeIntervalSinceNow < 24 * 3600
    }
}

/// "Due in 3:12:45", "Overdue", "Due Thu 27 Nov" or "Approved".
private struct DueBadge: View {
    let state: TaskAttributes.ContentState
    let stale: Bool
    var big = true

    var body: some View {
        if state.done {
            Label("Approved", systemImage: "checkmark.circle.fill")
                .font(.system(size: big ? 15 : 12, weight: .semibold))
                .foregroundStyle(NC.green)
        } else if let due = state.dueAt {
            if stale || due < Date() {
                Label("Overdue", systemImage: "exclamationmark.circle.fill")
                    .font(.system(size: big ? 15 : 12, weight: .semibold))
                    .foregroundStyle(NC.softRed)
            } else if state.dueSoon {
                VStack(alignment: .trailing, spacing: 0) {
                    Text(timerInterval: Date()...due, countsDown: true)
                        .font(.system(size: big ? 24 : 15, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: big ? 110 : 64, alignment: .trailing)
                        .foregroundStyle(due.timeIntervalSinceNow < 3 * 3600 ? NC.amber : .white)
                    if big {
                        Text("to the deadline")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(.white.opacity(0.6))
                    }
                }
            } else {
                Text("Due \(NC.day(due))")
                    .font(.system(size: big ? 13 : 11, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.85))
            }
        }
    }
}

private struct TaskLockScreen: View {
    let attrs: TaskAttributes
    let state: TaskAttributes.ContentState
    let stale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    NCEyebrow(text: attrs.eyebrow, tint: state.done ? NC.green : NC.softRed)
                    Text(attrs.title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                    let sub = [attrs.project, state.person].compactMap { $0 }.joined(separator: " · ")
                    if !sub.isEmpty {
                        Text(sub)
                            .font(.system(size: 12))
                            .foregroundStyle(.white.opacity(0.7))
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 6)
                DueBadge(state: state, stale: stale)
            }

            NCStageTrack(stages: state.stages, current: state.stage, tint: state.tint)
                .ncGlassPanel()

            HStack(spacing: 8) {
                Image(systemName: state.symbol)
                    .foregroundStyle(state.tint)
                    .contentTransition(.symbolEffect(.replace))
                Text(state.status)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.white.opacity(0.9))
                    .lineLimit(1)
                    .contentTransition(.opacity)
                if let p = state.progress, !state.done {
                    Text("\(p)%")
                        .font(.system(size: 12, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(.white.opacity(0.7))
                        .contentTransition(.numericText())
                }
                Spacer(minLength: 6)
                Link(destination: attrs.link) {
                    NCGlassButton(title: "Open", symbol: "arrow.up.forward.app", tint: state.done ? NC.green : NC.blue)
                }
            }
        }
        .padding(16)
    }
}

struct TaskLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TaskAttributes.self) { context in
            TaskLockScreen(attrs: context.attributes, state: context.state, stale: context.isStale)
                .activityBackgroundTint(NC.navy.opacity(0.55))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(context.attributes.link)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: context.state.symbol)
                        .font(.system(size: 22))
                        .foregroundStyle(context.state.tint)
                        .padding(.leading, 6)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    DueBadge(state: context.state, stale: context.isStale, big: false)
                        .padding(.trailing, 6)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 1) {
                        Text(context.attributes.title)
                            .font(.system(size: 14, weight: .semibold))
                            .lineLimit(1)
                        Text(context.state.status)
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    NCStageTrack(stages: context.state.stages, current: context.state.stage, tint: context.state.tint)
                        .padding(.horizontal, 6)
                        .padding(.top, 4)
                }
            } compactLeading: {
                Image(systemName: context.state.symbol)
                    .foregroundStyle(context.state.tint)
            } compactTrailing: {
                if let due = context.state.dueAt, !context.state.done, !context.isStale, context.state.dueSoon {
                    Text(timerInterval: Date()...due, countsDown: true)
                        .monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 52)
                } else {
                    Text("\(context.state.stage + 1)/\(context.state.stages.count)")
                        .font(.system(size: 13, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(context.isStale && !context.state.done ? NC.softRed : .white)
                }
            } minimal: {
                Image(systemName: context.state.symbol)
                    .foregroundStyle(context.state.tint)
            }
            .widgetURL(context.attributes.link)
            .keylineTint(context.state.tint)
        }
    }
}
