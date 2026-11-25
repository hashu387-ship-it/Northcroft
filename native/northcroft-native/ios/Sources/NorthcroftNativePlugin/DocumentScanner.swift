import Foundation
import UIKit
import VisionKit

/// The iPhone's document scanner (the same one as in Notes and Files): finds the page edges,
/// straightens and cleans up each page, and lets the person retake or add pages. The pages come
/// back as one PDF.
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
    /// stays small enough to send over a phone connection.
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
            }
        }
    }
}
