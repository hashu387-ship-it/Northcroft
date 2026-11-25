import UIKit
import UniformTypeIdentifiers

/// "Northcroft" in the iPhone share sheet. Takes the photos, files, link or text being shared,
/// copies them into the app group folder the app can read (Shared/<id>/ with a manifest.json),
/// and says so. The next time Northcroft opens it shows the Share screen to pick the task, chat or
/// project they go to (src/native/NativeBridge.tsx picks them up).
final class ShareViewController: UIViewController {
    /// The folder shared with the app: NCAppGroup in Info.plist, from the NC_APP_GROUP build setting.
    private let group: String = {
        if let v = Bundle.main.object(forInfoDictionaryKey: "NCAppGroup") as? String, !v.isEmpty, !v.contains("$(") { return v }
        return "group.com.northcroftme.qsteam"
    }()
    /// Files bigger than this are left out: they'd be too slow to hand over to the app.
    private let maxFileBytes = 40 * 1024 * 1024

    private let card = UIView()
    private let spinner = UIActivityIndicatorView(style: .large)
    private let titleLabel = UILabel()
    private let detailLabel = UILabel()
    private let doneButton = UIButton(type: .system)

    private let lock = NSLock()
    private var files: [[String: Any]] = []
    private var skipped: [String] = []
    private var text = ""
    private var link = ""

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.4)
        buildCard()
        collect()
    }

    // MARK: - The little card

    private func buildCard() {
        card.translatesAutoresizingMaskIntoConstraints = false
        card.backgroundColor = UIColor(red: 0.04, green: 0.10, blue: 0.20, alpha: 1)
        card.layer.cornerRadius = 22
        view.addSubview(card)

        spinner.color = .white
        spinner.startAnimating()

        titleLabel.text = "Adding to Northcroft"
        titleLabel.textColor = .white
        titleLabel.font = .systemFont(ofSize: 19, weight: .semibold)
        titleLabel.textAlignment = .center
        titleLabel.numberOfLines = 0

        detailLabel.text = "One moment..."
        detailLabel.textColor = UIColor(white: 1, alpha: 0.75)
        detailLabel.font = .systemFont(ofSize: 15)
        detailLabel.textAlignment = .center
        detailLabel.numberOfLines = 0

        doneButton.setTitle("Done", for: .normal)
        doneButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        doneButton.setTitleColor(.white, for: .normal)
        doneButton.backgroundColor = UIColor(red: 0.91, green: 0.17, blue: 0.20, alpha: 1)
        doneButton.layer.cornerRadius = 14
        doneButton.isHidden = true
        doneButton.addTarget(self, action: #selector(finish), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [spinner, titleLabel, detailLabel, doneButton])
        stack.axis = .vertical
        stack.spacing = 12
        stack.alignment = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.widthAnchor.constraint(equalToConstant: 300),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 26),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -22),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 22),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -22),
            doneButton.heightAnchor.constraint(equalToConstant: 48)
        ])
    }

    private func show(title: String, detail: String) {
        spinner.stopAnimating()
        spinner.isHidden = true
        titleLabel.text = title
        detailLabel.text = detail
        doneButton.isHidden = false
    }

    @objc private func finish() {
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }

    // MARK: - Collecting what was shared

    private func collect() {
        guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent("Shared", isDirectory: true) else {
            show(title: "Couldn't add it", detail: "Open Northcroft once, then try sharing again.")
            return
        }
        let id = UUID().uuidString
        let dir = root.appendingPathComponent(id, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        } catch {
            show(title: "Couldn't add it", detail: "There isn't room on the phone to keep it.")
            return
        }

        let group = DispatchGroup()
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        for item in items {
            if let t = item.attributedContentText?.string, !t.isEmpty, text.isEmpty { text = t }
            for provider in item.attachments ?? [] {
                group.enter()
                take(provider, into: dir) { group.leave() }
            }
        }

        group.notify(queue: .main) { [weak self] in
            self?.save(id: id, dir: dir)
        }
    }

    /// One shared thing: a web link, some text, or a file (photo, PDF, video...).
    private func take(_ provider: NSItemProvider, into dir: URL, done: @escaping () -> Void) {
        let isFileURL = provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) && !isFileURL {
            provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] value, _ in
                if let url = value as? URL { self?.locked { if self?.link.isEmpty == true { self?.link = url.absoluteString } } }
                done()
            }
            return
        }
        let types = provider.registeredTypeIdentifiers
        let onlyText = types.allSatisfy { UTType($0)?.conforms(to: .text) == true } && !isFileURL
        if onlyText && provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] value, _ in
                if let s = value as? String { self?.locked { if self?.text.isEmpty == true { self?.text = s } } }
                done()
            }
            return
        }
        // A file: the most specific type that is data (photos come as public.jpeg/heic, PDFs as com.adobe.pdf).
        let typeId = types.first { UTType($0)?.conforms(to: .data) == true } ?? UTType.data.identifier
        provider.loadFileRepresentation(forTypeIdentifier: typeId) { [weak self] url, _ in
            guard let self else { done(); return }
            if let url {
                self.copy(url, suggested: provider.suggestedName, typeId: typeId, into: dir)
                done()
            } else {
                // Some apps hand over a picture rather than a file.
                provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { value, _ in
                    if let image = value as? UIImage, let data = image.jpegData(compressionQuality: 0.9) {
                        self.write(data, name: (provider.suggestedName ?? "Photo") + ".jpg", type: "image/jpeg", into: dir)
                    }
                    done()
                }
            }
        }
    }

    private func copy(_ url: URL, suggested: String?, typeId: String, into dir: URL) {
        let type = UTType(typeId)
        var name = url.lastPathComponent
        if let suggested, !suggested.isEmpty {
            let ext = url.pathExtension.isEmpty ? (type?.preferredFilenameExtension ?? "") : url.pathExtension
            name = ext.isEmpty || suggested.lowercased().hasSuffix("." + ext.lowercased()) ? suggested : "\(suggested).\(ext)"
        }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if size > maxFileBytes {
            locked { skipped.append(name) }
            return
        }
        let target = uniqueURL(in: dir, name: name)
        do {
            try FileManager.default.copyItem(at: url, to: target)
            locked {
                files.append([
                    "name": target.lastPathComponent,
                    "file": target.lastPathComponent,
                    "type": type?.preferredMIMEType ?? "application/octet-stream",
                    "size": size
                ])
            }
        } catch {
            locked { skipped.append(name) }
        }
    }

    private func write(_ data: Data, name: String, type: String, into dir: URL) {
        let target = uniqueURL(in: dir, name: name)
        if (try? data.write(to: target)) != nil {
            locked { files.append(["name": target.lastPathComponent, "file": target.lastPathComponent, "type": type, "size": data.count]) }
        }
    }

    private func uniqueURL(in dir: URL, name: String) -> URL {
        let safe = name.replacingOccurrences(of: "/", with: "-")
        var target = dir.appendingPathComponent(safe)
        var n = 2
        let base = (safe as NSString).deletingPathExtension
        let ext = (safe as NSString).pathExtension
        while FileManager.default.fileExists(atPath: target.path) {
            target = dir.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
            n += 1
        }
        return target
    }

    private func locked(_ work: () -> Void) {
        lock.lock()
        work()
        lock.unlock()
    }

    private func save(id: String, dir: URL) {
        if files.isEmpty && text.isEmpty && link.isEmpty {
            try? FileManager.default.removeItem(at: dir)
            show(
                title: skipped.isEmpty ? "Nothing to add" : "Too big to add",
                detail: skipped.isEmpty ? "Northcroft couldn't read what was shared." : "Files over 40 MB can't be shared in. Add them from the app instead.")
            return
        }
        let manifest: [String: Any] = [
            "id": id,
            "at": ISO8601DateFormatter().string(from: Date()),
            "title": "",
            "text": text,
            "url": link,
            "files": files
        ]
        if let data = try? JSONSerialization.data(withJSONObject: manifest) {
            try? data.write(to: dir.appendingPathComponent("manifest.json"))
        }
        let what = files.isEmpty ? "It's" : (files.count == 1 ? "1 file is" : "\(files.count) files are")
        var detail = "\(what) waiting in Northcroft. Open the app to choose the task, chat or project."
        if !skipped.isEmpty { detail += " Left out (over 40 MB): \(skipped.joined(separator: ", "))." }
        show(title: "Added to Northcroft", detail: detail)
    }
}
