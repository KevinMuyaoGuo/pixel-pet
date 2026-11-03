# Pixel Pet

**A pixel-art desktop companion for macOS, built with Electron, TypeScript, React, and Vite.** It features frame-based animations, desktop roaming, menu bar controls, a standalone settings window, and saved window position.

[简体中文](README.zh-CN.md)

<p align="left">
  <img src="assets/demo.gif" height="180" alt="Pixel Pet demo">
</p>

## Features

- Transparent, frameless, always-on-top pet window
- Frame-based `idle`, `walk`, `heart`, and other animations
- Autonomous roaming, random pauses, screen-edge detection, and turning
- Menu bar controls, standalone settings, animation pause, and position lock
- Persistent local settings and window position
- Secure communication between the Electron main process and renderer through preload and IPC

## Run in Development

```sh
npm install
npm run dev
```

Press `⌘Q` or choose **Quit** from the menu bar menu to exit. Closing Settings only closes the settings window. Closing the pet window hides the pet; you can show it again from the menu bar.

## Build a macOS Test Version

The current build targets Apple Silicon (`arm64`). Run these commands on macOS:

```sh
npm run build:icons
npm run package:mac
```

The app and DMG are written to `release/`. The packaging script clears the old intermediate `.app` and DMG staging directory, but preserves existing DMG files. The test installer uses `unsigned` in its filename and includes a generated SHA256 file.

## Install and Open for the First Time

1. Download `Pixel Pet-1.0.0-arm64-unsigned.dmg` and verify it against the accompanying `.sha256` file.
2. Open the DMG and drag `Pixel Pet.app` onto the **Applications** shortcut.
3. Try to open Pixel Pet from Applications.
4. If macOS blocks it, open **System Settings → Privacy & Security**. In the Security section, choose **Open Anyway** for Pixel Pet, confirm, then open the app again.

If macOS reports that the app is “damaged” and the approval option is unavailable, first confirm that the DMG came from a trusted source and its SHA256 matches. You can then remove the download quarantine attribute from this app only:

```sh
xattr -dr com.apple.quarantine "/Applications/Pixel Pet.app"
```

Try opening the app again. This command only affects Pixel Pet; it does not disable or globally weaken Gatekeeper. If the app still will not launch, stop and contact the publisher instead of disabling system security.

See Apple's instructions for [safely opening apps on a Mac](https://support.apple.com/en-us/102445).

## Signing and Security Limitations

This DMG is an **unsigned, non-notarized personal test build**. The project has no Apple Developer ID certificate or notarization credentials. Configuration sets `identity: null`, `hardenedRuntime: false`, `notarize: false`, and `forceCodeSigning: false`. The packaging script disables automatic identity discovery and clears the known `CSC_*` / `APPLE_*` signing and notarization credential variables. It does not use `identity: "-"` to Ad-hoc sign the app bundle.

Inspection found no Team ID and no `Contents/_CodeSignature` resource seal in the app bundle. Electron's arm64 main executable does contain a linker-generated `adhoc,linker-signed` CodeDirectory. This is not a Developer ID signature and was not applied by electron-builder as an Ad-hoc app-bundle signature. Strict `codesign --verify --deep --strict` verification fails because this unsigned app has no bundle resource seal. The built app was launched through the macOS UI and displayed the pet successfully.

An unsigned app cannot let another Mac verify the publisher's identity or receive Apple's malware checks, so Gatekeeper may block its first launch. Manually approving the app means the user chose to continue; it does not mean Apple has signed or notarized the app. Public distribution should use Developer ID signing and Apple notarization.

This DMG contains only an Apple Silicon `arm64` build and does not run on Intel Macs. Login-at-startup behavior is not guaranteed for an unsigned test build.

## Verify the SHA256 Checksum

The adjacent `Pixel Pet-1.0.0-arm64-unsigned.dmg.sha256` file contains the DMG's SHA256 digest. This build's digest is `2c6d166ddeabec5dd4fbabcd64b7e7d8bdbb96546d2c2322e3ff6832c6a10aa7`. After downloading the DMG and sidecar file, run:

```sh
cd ~/Downloads
shasum -a 256 -c "Pixel Pet-1.0.0-arm64-unsigned.dmg.sha256"
```

`OK` means the downloaded file matches the digest. The publisher should provide the digest through an independent, trusted channel so an attacker cannot replace both the DMG and checksum together.

## Settings and Local Data

Settings are organized into General, Appearance, and Behavior sections. Changes are saved in Electron's `userData` directory:

- `settings.json`: application settings with a schema version
- `pet-window.json`: desktop pet window position

The main process is the only writer of configuration. Renderers access limited, typed fields through IPC exposed by preload. `contextIsolation` remains enabled, and renderer processes do not have direct Node.js access.

## Main Modules

| File or directory | Responsibility |
| --- | --- |
| `electron/main.ts` | Tray, windows, menus, login items, Dock, and IPC |
| `electron/settings-store.ts`, `electron/settings-types.ts` | Versioned settings and validation |
| `electron/wander-controller.ts` | Pet window movement and roaming control |
| `src/main.tsx`, `src/animation-system.ts` | Pet rendering and frame-based animation |
| `src/settings-main.tsx`, `src/settings.css`, `settings.html` | Standalone settings window |
| `public/` | Character image and animation assets |
| `assets/` | App and menu bar template icons |

## License

This repository does not currently declare an open-source license. Before public reuse or redistribution, add an appropriate LICENSE file and confirm the licensing terms for the character art and other assets.
