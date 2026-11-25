import Foundation
import UIKit
import Vision
import VisionKit

/// The iPhone's document scanner (the same one as in Notes and Files): finds the page edges,
/// straightens and cleans up each page, and lets the person retake or add pages. The pages come
/// back as one PDF, with the words on each page read (on the phone) and laid invisibly over the
/// picture, so the PDF can be searched and its text copied.
final class DocumentScanner: NSObject, VNDocumentCameraViewControllerDelegate {
    enum Outcome {
        case pdf(Data, pages: Int)
        case cancelled
        case failed(String)
    }

    static var isSupported: Bool { VNDocumentCameraViewController.isSupported }

    private var done: ((Outcome) -> Void)?
    /// Kept alive while the scanner is open.
    private static var current: DocumentScanner?

    static func present(from host: UIViewController, done: @escaping (Outcome) -> Void) {
        guard isSupported else {
            done(.failed("This iPhone can't scan documents."))
            return
        }
        let scanner = DocumentScanner()
        scanner.done = done
        current = scanner
        let vc = VNDocumentCameraViewController()
        vc.delegate = scanner
        vc.modalPresentationStyle = .fullScreen
        host.present(vc, animated: true)
    }

    private func finish(_ vc: VNDocumentCameraViewController, _ outcome: Outcome) {
        vc.dismiss(animated: true) {
            self.done?(outcome)
            self.done = nil
            DocumentScanner.current = nil
        }
    }

    func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
        guard scan.pageCount > 0 else {
            finish(controller, .cancelled)
            return
        }
        let pages = (0..<scan.pageCount).map { scan.imageOfPage(at: $0) }
        DispatchQueue.global(qos: .userInitiated).async {
            let data = DocumentScanner.makePDF(pages)
            DispatchQueue.main.async { self.finish(controller, .pdf(data, pages: pages.count)) }
        }
    }

    func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        finish(controller, .cancelled)
    }

    func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        finish(controller, .failed(error.localizedDescription))
    }

    /// One page per scan, A4 width (595 pt) with the page's own proportions, as JPEG so the file
    /// stays small enough to send over a phone connection. The recognised text goes on top,
    /// invisible, in the same place as the words in the picture.
    static func makePDF(_ images: [UIImage]) -> Data {
        let width: CGFloat = 595
        let format = UIGraphicsPDFRendererFormat()
        format.documentInfo = [kCGPDFContextCreator as String: "Northcroft"]
        let first = images.first?.size ?? CGSize(width: 595, height: 842)
        let firstBounds = CGRect(x: 0, y: 0, width: width, height: width * max(first.height, 1) / max(first.width, 1))
        let renderer = UIGraphicsPDFRenderer(bounds: firstBounds, format: format)
        return renderer.pdfData { ctx in
            for image in images {
                let size = image.size
                let bounds = CGRect(x: 0, y: 0, width: width, height: width * max(size.height, 1) / max(size.width, 1))
                ctx.beginPage(withBounds: bounds, pageInfo: [:])
                let jpeg = image.jpegData(compressionQuality: 0.6).flatMap(UIImage.init(data:)) ?? image
                jpeg.draw(in: bounds)
                for line in readText(image) {
                    drawInvisible(line.text, in: CGRect(
                        x: line.box.minX * bounds.width,
                        y: (1 - line.box.maxY) * bounds.height,
                        width: line.box.width * bounds.width,
                        height: line.box.height * bounds.height), ctx: ctx.cgContext)
                }
            }
        }
    }

    /// The lines of text on a page, with where each one is (0...1, origin bottom left).
    private static func readText(_ image: UIImage) -> [(text: String, box: CGRect)] {
        guard let cg = image.cgImage else { return [] }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        if #available(iOS 16.0, *) { request.automaticallyDetectsLanguage = true }
        let handler = VNImageRequestHandler(cgImage: cg, orientation: cgOrientation(image.imageOrientation), options: [:])
        do {
            try handler.perform([request])
        } catch {
            return []
        }
        return (request.results ?? []).compactMap { obs in
            guard let best = obs.topCandidates(1).first, !best.string.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
            return (best.string, obs.boundingBox)
        }
    }

    /// Text that searches and copies but doesn't show: clear, stretched to fill its box.
    private static func drawInvisible(_ text: String, in rect: CGRect, ctx: CGContext) {
        guard rect.width > 1, rect.height > 1 else { return }
        let font = UIFont.systemFont(ofSize: max(rect.height * 0.85, 1))
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.clear]
        let s = NSAttributedString(string: text, attributes: attrs)
        let natural = s.size()
        guard natural.width > 0 else { return }
        ctx.saveGState()
        ctx.translateBy(x: rect.minX, y: rect.minY)
        ctx.scaleBy(x: rect.width / natural.width, y: 1)
        s.draw(at: .zero)
        ctx.restoreGState()
    }

    private static func cgOrientation(_ o: UIImage.Orientation) -> CGImagePropertyOrientation {
        switch o {
        case .up: return .up
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }
}
