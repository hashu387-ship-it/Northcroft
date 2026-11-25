import SwiftUI
import WidgetKit

// Shared pieces for the Live Activities (workday, tasks, site trips): Northcroft's colours, the
// Liquid Glass button and panel (iOS 26 and later, a plain fill before), and the delivery-style
// stage track.

enum NC {
    static let red = Color(red: 0.91, green: 0.17, blue: 0.20)
    static let softRed = Color(red: 1, green: 0.45, blue: 0.47)
    static let green = Color(red: 0.20, green: 0.78, blue: 0.45)
    static let blue = Color(red: 0.30, green: 0.58, blue: 1.0)
    static let amber = Color(red: 1.0, green: 0.72, blue: 0.25)
    static let navy = Color(red: 7 / 255, green: 23 / 255, blue: 51 / 255)

    static let zone = TimeZone(identifier: "Asia/Riyadh") ?? .current

    static func time(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = zone
        f.dateFormat = "h:mm a"
        return f.string(from: d).lowercased()
    }

    static func day(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = zone
        f.dateFormat = "EEE d MMM"
        return f.string(from: d)
    }
}

/// The small caps line at the top: "NORTHCROFT · WORKDAY".
struct NCEyebrow: View {
    let text: String
    var tint: Color = NC.softRed

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10, weight: .bold))
            .kerning(1.1)
            .foregroundStyle(tint)
            .lineLimit(1)
    }
}

/// A capsule button: Liquid Glass with a tint on iOS 26 and later, a solid capsule before.
struct NCGlassButton: View {
    let title: String
    let symbol: String
    var tint: Color = NC.red

    var body: some View {
        let label = Label(title, systemImage: symbol)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.white)
            .lineLimit(1)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
        if #available(iOS 26.0, *) {
            label.glassEffect(.regular.tint(tint.opacity(0.75)).interactive(), in: Capsule())
        } else {
            label.background(tint, in: Capsule())
        }
    }
}

/// A soft glass panel behind a group (the stage track, the trip bar).
struct NCGlassPanel: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .glassEffect(.regular.tint(.white.opacity(0.06)), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        } else {
            content
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }
}

extension View {
    func ncGlassPanel() -> some View { modifier(NCGlassPanel()) }
}

/// The stages, like a delivery's: dots joined by a line, done ones filled, the current one ringed.
struct NCStageTrack: View {
    let stages: [String]
    let current: Int
    var tint: Color = NC.green
    var showLabels = true

    var body: some View {
        VStack(spacing: 5) {
            HStack(spacing: 0) {
                ForEach(Array(stages.enumerated()), id: \.offset) { i, _ in
                    if i > 0 {
                        Capsule()
                            .fill(i <= current ? tint : .white.opacity(0.22))
                            .frame(height: 3)
                    }
                    ZStack {
                        Circle()
                            .fill(i <= current ? tint : .white.opacity(0.22))
                            .frame(width: i == current ? 12 : 9, height: i == current ? 12 : 9)
                        if i == current {
                            Circle()
                                .stroke(tint.opacity(0.45), lineWidth: 4)
                                .frame(width: 18, height: 18)
                        }
                    }
                    .frame(width: 18, height: 18)
                }
            }
            if showLabels {
                HStack(spacing: 0) {
                    ForEach(Array(stages.enumerated()), id: \.offset) { i, name in
                        Text(name)
                            .font(.system(size: 9, weight: i == current ? .bold : .medium))
                            .foregroundStyle(i == current ? .white : .white.opacity(0.6))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .frame(maxWidth: .infinity, alignment: i == 0 ? .leading : i == stages.count - 1 ? .trailing : .center)
                    }
                }
            }
        }
    }
}
