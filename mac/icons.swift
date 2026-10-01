// assets/icon.svg 하나로 맥 아이콘 묶음(AppIcon.iconset)과 윈도우 아이콘(icon-transparent.ico)을 만든다.
// 둥근 판 바깥 모서리는 투명하게 남긴다. 쓰는 법: swift icons.swift <icon.svg> <iconset 폴더> <ico 파일>
import AppKit

let args = CommandLine.arguments
guard args.count == 4, let image = NSImage(contentsOfFile: args[1]) else { fatalError("쓰는 법: swift icons.swift <icon.svg> <iconset 폴더> <ico 파일>") }

func png(_ size: Int) -> Data {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  NSGraphicsContext.current?.imageInterpolation = .high
  image.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])!
}

let iconset = URL(fileURLWithPath: args[2])
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
  try png(size).write(to: iconset.appendingPathComponent("icon_\(size)x\(size).png"))
  try png(size * 2).write(to: iconset.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}

// .ico: PNG를 그대로 담는 형식(윈도우 Vista 이후)
let sizes = [16, 24, 32, 48, 64, 128, 256]
let images = sizes.map(png)
var ico = Data()
func put16(_ value: Int) { ico.append(contentsOf: [UInt8(value & 0xff), UInt8(value >> 8 & 0xff)]) }
func put32(_ value: Int) { put16(value & 0xffff); put16(value >> 16) }
put16(0); put16(1); put16(sizes.count)
var offset = 6 + 16 * sizes.count
for (size, data) in zip(sizes, images) {
  ico.append(contentsOf: [UInt8(size % 256), UInt8(size % 256), 0, 0])
  put16(1); put16(32); put32(data.count); put32(offset)
  offset += data.count
}
images.forEach { ico.append($0) }
try ico.write(to: URL(fileURLWithPath: args[3]))
