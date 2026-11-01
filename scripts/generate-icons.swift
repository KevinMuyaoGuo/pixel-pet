import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let assets = root.appendingPathComponent("assets", isDirectory: true)
let iconset = assets.appendingPathComponent("pixel-pet.iconset", isDirectory: true)
let manager = FileManager.default
try manager.createDirectory(at: assets, withIntermediateDirectories: true)

func resizePNG(_ source: String, width: Int, height: Int, output: String) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/sips")
    process.arguments = ["-z", "\(height)", "\(width)", assets.appendingPathComponent(source).path,
                        "--out", assets.appendingPathComponent(output).path]
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
        throw NSError(domain: "IconGeneration", code: Int(process.terminationStatus))
    }
}

let appSource = assets.appendingPathComponent("app_icon.png")
let menuSource = assets.appendingPathComponent("menubar_icon.png")
let menu2xSource = assets.appendingPathComponent("menubar_icon@2x.png")
for source in [appSource, menuSource, menu2xSource] {
    guard manager.fileExists(atPath: source.path) else {
        throw NSError(domain: "IconGeneration", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "Missing icon source: \(source.lastPathComponent)"])
    }
}

// Keep the standard intermediate asset aligned with the selected app icon.
try Data(contentsOf: appSource).write(to: assets.appendingPathComponent("pixel-pet.png"), options: .atomic)

// macOS menu bar images use 18 logical pixels and a 36-pixel Retina variant.
try resizePNG("menubar_icon.png", width: 18, height: 18, output: "PixelPetTemplate.png")
try resizePNG("menubar_icon@2x.png", width: 36, height: 36, output: "PixelPetTemplate@2x.png")

try? manager.removeItem(at: iconset)
try manager.createDirectory(at: iconset, withIntermediateDirectories: true)
let iconSizes = [
    (16, "icon_16x16.png"), (32, "icon_16x16@2x.png"),
    (32, "icon_32x32.png"), (64, "icon_32x32@2x.png"),
    (128, "icon_128x128.png"), (256, "icon_128x128@2x.png"),
    (256, "icon_256x256.png"), (512, "icon_256x256@2x.png"),
    (512, "icon_512x512.png"), (1024, "icon_512x512@2x.png"),
]
for (size, name) in iconSizes {
    try resizePNG("app_icon.png", width: size, height: size,
                  output: "pixel-pet.iconset/\(name)")
}

func appendBigEndian(_ value: UInt32, to data: inout Data) {
    var value = value.bigEndian
    withUnsafeBytes(of: &value) { data.append(contentsOf: $0) }
}

let icnsImages: [(String, String)] = [
    ("icp4", "icon_16x16.png"),
    ("icp5", "icon_16x16@2x.png"),
    ("icp6", "icon_32x32@2x.png"),
    ("ic07", "icon_128x128.png"),
    ("ic08", "icon_128x128@2x.png"),
    ("ic09", "icon_256x256@2x.png"),
    ("ic10", "icon_512x512@2x.png"),
]
var chunks = Data()
for (type, name) in icnsImages {
    let image = try Data(contentsOf: iconset.appendingPathComponent(name))
    chunks.append(contentsOf: type.utf8)
    appendBigEndian(UInt32(image.count + 8), to: &chunks)
    chunks.append(image)
}
var icns = Data("icns".utf8)
appendBigEndian(UInt32(chunks.count + 8), to: &icns)
icns.append(chunks)
try icns.write(to: assets.appendingPathComponent("pixel-pet.icns"), options: .atomic)
try manager.removeItem(at: iconset)
print("Generated Pixel Pet app and menu bar icons from the assets/ source PNGs.")
