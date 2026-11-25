import Foundation
import CoreSpotlight
import UniformTypeIdentifiers

/// Northcroft projects and the person's open tasks in the iPhone's own search (Spotlight).
/// Everything stays on the phone. Tapping a result opens it (LaunchActions.handle(activity:)).
enum SpotlightIndex {
    static let domain = "northcroft"

    /// Replaces what's in Spotlight with these items: path ("/tasks/<id>"), title, subtitle, keywords.
    static func replace(_ items: [[String: Any]], done: @escaping (Int) -> Void) {
        let list: [CSSearchableItem] = items.compactMap { it in
            guard let path = it["path"] as? String, LaunchActions.isAllowed(path),
                  let title = it["title"] as? String, !title.isEmpty else { return nil }
            let attrs = CSSearchableItemAttributeSet(contentType: .text)
            attrs.title = title
            attrs.contentDescription = it["subtitle"] as? String
            attrs.keywords = ((it["keywords"] as? [Any]) ?? []).compactMap { $0 as? String } + ["Northcroft"]
            return CSSearchableItem(uniqueIdentifier: "nc:\(path)", domainIdentifier: domain, attributeSet: attrs)
        }
        let index = CSSearchableIndex.default()
        index.deleteSearchableItems(withDomainIdentifiers: [domain]) { _ in
            guard !list.isEmpty else { return done(0) }
            index.indexSearchableItems(list) { error in done(error == nil ? list.count : 0) }
        }
    }

    static func clear() {
        CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: [domain], completionHandler: nil)
    }
}
