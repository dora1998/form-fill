// Generate the code-defined Form Fill mark. Run on macOS with `swift scripts/render-icons.swift`.
import AppKit
import ImageIO
import UniformTypeIdentifiers

func render(size: Int, path: String) throws {
    let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
        bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
    let scale = CGFloat(size) / 1024
    let transform = AffineTransform(scale: scale)
    (transform as NSAffineTransform).concat()
    NSGradient(starting: NSColor(red: 0.10, green: 0.27, blue: 0.64, alpha: 1),
        ending: NSColor(red: 0.18, green: 0.46, blue: 0.92, alpha: 1))!
        .draw(in: NSRect(x: 0, y: 0, width: 1024, height: 1024), angle: 60)
    NSColor.white.setFill()
    NSBezierPath(roundedRect: NSRect(x: 215, y: 230, width: 560, height: 585), xRadius: 70, yRadius: 70).fill()
    NSColor(red: 0.17, green: 0.40, blue: 0.82, alpha: 1).setFill()
    for (y, width) in [(CGFloat(635), CGFloat(320)), (CGFloat(515), CGFloat(245)), (CGFloat(395), CGFloat(180))] {
        NSBezierPath(roundedRect: NSRect(x: 290, y: y, width: width, height: 40), xRadius: 20, yRadius: 20).fill()
    }
    NSColor(red: 0.10, green: 0.72, blue: 0.68, alpha: 1).setFill()
    NSBezierPath(ovalIn: NSRect(x: 545, y: 155, width: 320, height: 320)).fill()
    NSColor.white.setStroke()
    let check = NSBezierPath(); check.lineWidth = 36; check.lineCapStyle = .round; check.lineJoinStyle = .round
    check.move(to: NSPoint(x: 625, y: 312)); check.line(to: NSPoint(x: 683, y: 258)); check.line(to: NSPoint(x: 791, y: 372)); check.stroke()
    NSGraphicsContext.restoreGraphicsState()
    let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, context.makeImage()!, nil)
    guard CGImageDestinationFinalize(destination) else { throw CocoaError(.fileWriteUnknown) }
}
try render(size: 1024, path: "App/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
for size in [32, 48, 64, 96, 128] { try render(size: size, path: "SafariExtension/Resources/icon-\(size).png") }
