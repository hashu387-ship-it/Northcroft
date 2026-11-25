import Foundation
import ActivityKit

/// A task on the lock screen and in the Dynamic Island, delivery-app style: the stages it goes
/// through (Assigned, In progress, Submitted, First OK, Approved) with the current one lit, a
/// countdown to the deadline, and an Open task button. Shown to the people on the task and to the
/// person who gave it. The web app decides which tasks (src/native/liveTasks.ts) and sends them
/// with liveTasks each time the app opens or a task changes while it is open.
/// The widget extension draws it (ios/App/NorthcroftWidget/TaskLiveActivity.swift), with its own
/// copy of these attributes: the two must stay field for field the same.
public struct TaskAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Index into stages of where the task is now.
        public var stage: Int
        public var stages: [String]
        /// One line on what's happening: "Waiting for Fawaz's final OK", "Changes asked".
        public var status: String
        /// Who is on the other side: who gave it (for the people on it) or who is on it.
        public var person: String?
        /// The deadline: the due date at the end of office hours.
        public var dueAt: Date?
        /// 0 to 100 while in progress, when the people on it have set it.
        public var progress: Int?
        public var held: Bool
        public var done: Bool
    }

    public var taskId: String
    public var title: String
    public var project: String?
    /// "mine": I'm on the task. "given": I gave it to someone.
    public var role: String
}

@available(iOS 16.2, *)
enum LiveTasks {
    /// Makes the running task activities match the list: new ones start, changed ones update,
    /// finished ones show Approved for a while, and the rest end. Returns how many are running.
    static func sync(_ items: [[String: Any]]) async -> Int {
        let running = Activity<TaskAttributes>.activities
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            for a in running { await a.end(nil, dismissalPolicy: .immediate) }
            return 0
        }
        var wanted: [String: (TaskAttributes, TaskAttributes.ContentState)] = [:]
        var order: [String] = []
        for item in items.prefix(4) {
            guard let id = item["id"] as? String, let title = item["title"] as? String else { continue }
            let attrs = TaskAttributes(
                taskId: id,
                title: String(title.prefix(80)),
                project: item["project"] as? String,
                role: (item["role"] as? String) == "given" ? "given" : "mine")
            let stages = (item["stages"] as? [String] ?? ["Assigned", "In progress", "Submitted", "Approved"]).prefix(5).map { String($0.prefix(14)) }
            let stage = max(0, min((item["stage"] as? Int) ?? 0, stages.count - 1))
            let state = TaskAttributes.ContentState(
                stage: stage,
                stages: Array(stages),
                status: String((item["status"] as? String ?? "").prefix(60)),
                person: item["person"] as? String,
                dueAt: (item["dueAtMs"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) },
                progress: (item["progress"] as? Int).map { max(0, min($0, 100)) },
                held: item["held"] as? Bool ?? false,
                done: item["done"] as? Bool ?? false)
            wanted[id] = (attrs, state)
            order.append(id)
        }

        var handled = Set<String>()
        for a in running {
            // Already finished (showing Approved until it's dismissed): leave it be.
            if a.activityState == .ended || a.activityState == .dismissed { continue }
            let id = a.attributes.taskId
            guard let (attrs, state) = wanted[id], !handled.contains(id) else {
                await a.end(nil, dismissalPolicy: .immediate)
                continue
            }
            if attrs.title != a.attributes.title || attrs.project != a.attributes.project || attrs.role != a.attributes.role {
                // The fixed details changed (renamed task): start it again below.
                await a.end(nil, dismissalPolicy: .immediate)
                continue
            }
            handled.insert(id)
            if state.done {
                // Approved: show it for half an hour, then let it go.
                await a.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(30 * 60)))
            } else if a.content.state != state {
                await a.update(ActivityContent(state: state, staleDate: staleDate(state)))
            }
        }

        var count = handled.count
        for id in order where !handled.contains(id) {
            guard let (attrs, state) = wanted[id], !state.done else { continue }
            do {
                _ = try Activity.request(attributes: attrs, content: ActivityContent(state: state, staleDate: staleDate(state)), pushType: nil)
                count += 1
            } catch {
                // Too many running, or the person turned Live Activities off: skip it.
            }
        }
        return count
    }

    static func endAll() async {
        for a in Activity<TaskAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
    }

    /// At the deadline the activity turns stale, and the lock screen shows it as overdue (a task
    /// that is already late is stale from the start).
    private static func staleDate(_ s: TaskAttributes.ContentState) -> Date {
        if let due = s.dueAt { return due }
        return Date().addingTimeInterval(8 * 3600)
    }
}
