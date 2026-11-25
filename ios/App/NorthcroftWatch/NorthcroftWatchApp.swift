import SwiftUI
import WatchConnectivity

// Northcroft on the Apple Watch: whether you've checked in today and your tasks due today, with a
// Check in button that hands over to the iPhone (checking in needs the iPhone's sign-in and
// location). The iPhone sends the same copy it gives the home screen widget (WatchBridge.swift in
// native/northcroft-native) whenever it changes.

@main
struct NorthcroftWatchApp: App {
    @StateObject private var phone = PhoneLink.shared

    var body: some Scene {
        WindowGroup {
            TodayView()
                .environmentObject(phone)
        }
    }
}

// MARK: - The copy from the iPhone

struct WatchSnapshot: Codable, Equatable {
    struct Item: Codable, Equatable, Identifiable {
        let id: String
        let title: String
        let due: String?
        let project: String?
        let late: Bool?
    }

    let day: String
    let firstName: String?
    let exempt: Bool?
    let checkedIn: Bool
    let checkInAt: String?
    let checkedOut: Bool?
    let checkOutAt: String?
    let place: String?
    let dueToday: Int
    let late: Int
    let tasks: [Item]

    /// The copy is from today (Riyadh time, as the app counts days).
    var current: Bool {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Riyadh") ?? .current
        f.dateFormat = "yyyy-MM-dd"
        return day == f.string(from: Date())
    }
}

/// The link to the iPhone: receives the copy, and asks the iPhone to check in.
final class PhoneLink: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = PhoneLink()

    @Published var snapshot: WatchSnapshot?
    @Published var sending = false
    @Published var note: String?

    private let key = "nc.watch.snapshot"

    override init() {
        super.init()
        if let data = UserDefaults.standard.data(forKey: key) {
            snapshot = try? JSONDecoder().decode(WatchSnapshot.self, from: data)
        }
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    private func take(_ context: [String: Any]) {
        guard let data = context["snapshot"] as? Data,
              let snap = try? JSONDecoder().decode(WatchSnapshot.self, from: data) else {
            if context["signedOut"] as? Bool == true {
                DispatchQueue.main.async { self.snapshot = nil }
                UserDefaults.standard.removeObject(forKey: key)
            }
            return
        }
        UserDefaults.standard.set(data, forKey: key)
        DispatchQueue.main.async { self.snapshot = snap }
    }

    /// Asks the iPhone to check in. It opens Northcroft there (or shows a notification to tap).
    func checkIn() {
        guard WCSession.default.activationState == .activated, WCSession.default.isReachable else {
            note = "Open Northcroft on your iPhone to check in."
            return
        }
        sending = true
        note = nil
        WCSession.default.sendMessage(["action": "checkin"], replyHandler: { _ in
            DispatchQueue.main.async {
                self.sending = false
                self.note = "Finish on your iPhone."
            }
        }, errorHandler: { _ in
            DispatchQueue.main.async {
                self.sending = false
                self.note = "Couldn't reach your iPhone. Check in there instead."
            }
        })
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if activationState == .activated { take(session.receivedApplicationContext) }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        take(applicationContext)
    }
}

// MARK: - The screen

private extension Color {
    static let ncRed = Color(red: 0.91, green: 0.17, blue: 0.20)
    static let ncGreen = Color(red: 0.20, green: 0.78, blue: 0.45)
    static let ncNavy = Color(red: 7 / 255, green: 23 / 255, blue: 51 / 255)
}

/// A rounded panel: Liquid Glass on watchOS 26 and later.
private struct Panel: ViewModifier {
    func body(content: Content) -> some View {
        if #available(watchOS 26.0, *) {
            content
                .padding(12)
                .glassEffect(.regular.tint(Color.ncNavy.opacity(0.35)), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        } else {
            content
                .padding(12)
                .background(Color.ncNavy.opacity(0.55), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
    }
}

struct TodayView: View {
    @EnvironmentObject var phone: PhoneLink

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if let s = phone.snapshot {
                        if !(s.exempt ?? false) { checkIn(s) }
                        tasks(s)
                    } else {
                        Text("Open Northcroft on your iPhone and sign in. Your day shows here.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .modifier(Panel())
                    }
                }
                .animation(.spring(response: 0.4, dampingFraction: 0.8), value: phone.snapshot)
            }
            .navigationTitle("Northcroft")
        }
    }

    @ViewBuilder private func checkIn(_ s: WatchSnapshot) -> some View {
        let inNow = s.current && s.checkedIn
        let out = s.current && (s.checkedOut ?? false)
        VStack(alignment: .leading, spacing: 6) {
            Label(out ? "Checked out" : inNow ? "Checked in" : "Not checked in", systemImage: inNow ? "checkmark.circle.fill" : "mappin.circle.fill")
                .font(.headline)
                .foregroundStyle(inNow ? Color.ncGreen : Color.ncRed)
                .contentTransition(.symbolEffect(.replace))
            if inNow, let t = out ? s.checkOutAt : s.checkInAt {
                Text([t, s.place].compactMap { $0 }.joined(separator: " · "))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else if !inNow {
                Button {
                    phone.checkIn()
                } label: {
                    Label(phone.sending ? "Asking your iPhone…" : "Check in", systemImage: "iphone.and.arrow.forward")
                        .frame(maxWidth: .infinity)
                }
                .tint(.ncRed)
                .disabled(phone.sending)
                if let note = phone.note {
                    Text(note).font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
        .modifier(Panel())
    }

    @ViewBuilder private func tasks(_ s: WatchSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(s.current ? (s.dueToday == 0 ? "Nothing due today" : "\(s.dueToday) due today") : "Open Northcroft to refresh")
                    .font(.headline)
                    .contentTransition(.numericText())
                if s.current && s.late > 0 {
                    Text("\(s.late) late").font(.footnote.bold()).foregroundStyle(Color.ncRed)
                }
            }
            if s.current {
                ForEach(s.tasks.prefix(5)) { t in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(t.title).font(.footnote).lineLimit(2)
                        Text([t.project, t.due].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption2)
                            .foregroundStyle((t.late ?? false) ? Color.ncRed : .secondary)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .modifier(Panel())
    }
}
