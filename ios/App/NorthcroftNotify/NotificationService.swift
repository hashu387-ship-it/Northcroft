import UserNotifications
import Intents
import UIKit

/// Gives Northcroft notifications the sender's face, the way Messages and WhatsApp do: a chat
/// message, an approval request or a task from Saheeb shows Saheeb's photo (or his initials in his
/// colour) with the Northcroft icon tucked in the corner, and Siri can read it out as a message.
///
/// iOS runs this for each notification the server marks "mutable-content" (send-push does for
/// every notification with a person behind it), before showing it. The server sends the person
/// as "sender": { id, name, photo, initials, color }, and "group" for a group or project chat.
/// Anything that goes wrong (no photo, slow network) shows the notification as it came.
final class NotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var original: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        self.contentHandler = contentHandler
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            contentHandler(request.content)
            return
        }
        FocusRules.apply(to: content)
        original = content
        guard let sender = content.userInfo["sender"] as? [String: Any], let name = sender["name"] as? String, !name.isEmpty else {
            finish(content)
            return
        }
        let senderId = (sender["id"] as? String) ?? name
        let group = (content.userInfo["group"] as? String).flatMap { $0.isEmpty ? nil : $0 }

        photo(for: sender) { [weak self] data in
            guard let self else { return }
            let image = data.map { INImage(imageData: $0) }
            let person = INPerson(
                personHandle: INPersonHandle(value: senderId, type: .unknown),
                nameComponents: nil,
                displayName: name,
                image: image,
                contactIdentifier: nil,
                customIdentifier: senderId)
            let me = INPerson(
                personHandle: INPersonHandle(value: "me", type: .unknown),
                nameComponents: nil,
                displayName: nil,
                image: nil,
                contactIdentifier: nil,
                customIdentifier: nil,
                isMe: true)

            // In a group the group's name becomes the title and the sender's name the subtitle, so the
            // "Site team: " the server puts at the start of the message isn't needed.
            var body = content.body
            if let group, body.hasPrefix("\(group): ") { body = String(body.dropFirst(group.count + 2)) }
            content.body = body

            var recipients = [me]
            if group != nil {
                // iOS shows the group style only with more than one other person in the chat.
                recipients.append(INPerson(personHandle: INPersonHandle(value: "team", type: .unknown), nameComponents: nil, displayName: "Team", image: nil, contactIdentifier: nil, customIdentifier: "team"))
            }
            let intent = INSendMessageIntent(
                recipients: recipients,
                outgoingMessageType: .outgoingMessageText,
                content: body,
                speakableGroupName: group.map { INSpeakableString(spokenPhrase: $0) },
                conversationIdentifier: content.threadIdentifier.isEmpty ? senderId : content.threadIdentifier,
                serviceName: nil,
                sender: person,
                attachments: nil)

            let interaction = INInteraction(intent: intent, response: nil)
            interaction.direction = .incoming
            interaction.donate { _ in
                if let updated = try? content.updating(from: intent) {
                    self.finish(updated)
                } else {
                    self.finish(content)
                }
            }
        }
    }

    override func serviceExtensionTimeWillExpire() {
        if let original { finish(original) }
    }

    private func finish(_ content: UNNotificationContent) {
        guard let handler = contentHandler else { return }
        contentHandler = nil
        handler(content)
    }

    // MARK: - The face

    /// The person's photo, or their initials on their colour when there's no photo (or it can't be
    /// fetched in time).
    private func photo(for sender: [String: Any], done: @escaping (Data?) -> Void) {
        let fallback = { done(Self.initialsImage(sender)) }
        guard let link = sender["photo"] as? String, let url = URL(string: link), url.scheme == "https" else {
            fallback()
            return
        }
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        config.timeoutIntervalForResource = 10
        URLSession(configuration: config).dataTask(with: url) { data, response, _ in
            let ok = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
            guard ok, let data, let image = UIImage(data: data) else {
                fallback()
                return
            }
            done(Self.square(image).flatMap { $0.jpegData(compressionQuality: 0.85) } ?? data)
        }.resume()
    }

    /// A centred square crop, 256 points, so the round face isn't stretched.
    private static func square(_ image: UIImage) -> UIImage? {
        let side = min(image.size.width, image.size.height)
        guard side > 0 else { return nil }
        let size = CGSize(width: 256, height: 256)
        let scale = 256 / side
        return UIGraphicsImageRenderer(size: size).image { _ in
            let w = image.size.width * scale
            let h = image.size.height * scale
            image.draw(in: CGRect(x: (256 - w) / 2, y: (256 - h) / 2, width: w, height: h))
        }
    }

    private static func initialsImage(_ sender: [String: Any]) -> Data? {
        let initials = ((sender["initials"] as? String) ?? String(((sender["name"] as? String) ?? "?").prefix(2))).uppercased()
        let colour = color(hex: sender["color"] as? String) ?? UIColor(red: 0.16, green: 0.36, blue: 0.75, alpha: 1)
        let size = CGSize(width: 256, height: 256)
        let image = UIGraphicsImageRenderer(size: size).image { ctx in
            colour.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            let style = NSMutableParagraphStyle()
            style.alignment = .center
            let font = UIFont.systemFont(ofSize: 104, weight: .semibold)
            let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.white, .paragraphStyle: style]
            let h = font.lineHeight
            (initials as NSString).draw(in: CGRect(x: 0, y: (256 - h) / 2, width: 256, height: h), withAttributes: attrs)
        }
        return image.pngData()
    }

    private static func color(hex: String?) -> UIColor? {
        guard var s = hex?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return nil }
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        return UIColor(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }
}

/// What the "Northcroft" Focus filter asked for (Settings > Focus > a Focus > Focus Filters; see
/// FocusFilter in App/NorthcroftIntents.swift): during that Focus, chat messages, or everything that
/// isn't urgent, arrive quietly in Notification Centre instead of lighting up the screen. Calls,
/// approvals and other time-sensitive alerts always come through as usual.
enum FocusRules {
    static var group: String {
        if let v = Bundle.main.object(forInfoDictionaryKey: "NCAppGroup") as? String, !v.isEmpty, !v.contains("$(") { return v }
        return "group.com.northcroftme.qsteam"
    }

    static func apply(to content: UNMutableNotificationContent) {
        guard #available(iOS 15.0, *) else { return }
        guard let rules = UserDefaults(suiteName: group)?.dictionary(forKey: "focus.filter") else { return }
        if content.interruptionLevel == .timeSensitive || content.interruptionLevel == .critical { return }
        let type = content.userInfo["type"] as? String ?? ""
        let isChat = type == "chat" || type == "mention" || content.userInfo["group"] != nil || (content.userInfo["url"] as? String ?? "").hasPrefix("/chat")
        let urgentOnly = rules["urgentOnly"] as? Bool ?? false
        let quietChats = rules["quietChats"] as? Bool ?? false
        if urgentOnly || (quietChats && isChat) {
            content.interruptionLevel = .passive
            content.relevanceScore = 0.1
            content.sound = nil
        }
    }
}
