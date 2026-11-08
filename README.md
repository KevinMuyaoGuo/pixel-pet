# Pixel Pet

**A pixel-art desktop companion for macOS, built with Electron, TypeScript, React, and Vite.** It features frame-based animations, desktop roaming, menu bar controls, a standalone settings window, and saved window position.

[简体中文](README.zh-CN.md)

<p align="left">
  <img src="assets/demo.gif" height="180" alt="Pixel Pet demo">
</p>

## Features

- Transparent, frameless, always-on-top pet window
- Frame-based idle, walk, wave, heart, sit, and stand-up animations
- Autonomous roaming, random pauses, screen-edge detection, and turning
- Menu bar controls, standalone settings, animation pause, and position lock
- Persistent local settings and window position
- Secure communication between the Electron main process and renderer through preload and IPC

## v0.6 — Interactive Companion

- Left-click the pet to pick a random line. “你好呀！” (Hello!) plays a wave, and “爱你哦~” (Love you!) plays a heart when Click to heart is enabled. The other lines only show text. During either action, repeated clicks keep the current line and animation paired.
- The six-frame wave plays once at 4 fps and returns to idle. Its visible height and foot position match idle. If roaming is enabled, it resumes after a rest.
- One pixel-art speech bubble follows the pet for 2.6 seconds. Its tail points upward when the bubble appears below the pet near the top of the screen. Mouse input passes through the bubble, and keyboard focus stays where it was.
- After 60 seconds without interaction, auto-sit suspends roaming, plays the four-frame sit transition, and holds the seated pose. Hovering over the seated pet reverses the transition from the current frame to stand it back up. Clicking, dragging, starting roaming, or disabling auto-sit also wakes it. Pause and one-shot actions defer the inactivity deadline.
- Missing sit frames fall back to a standing idle frame, or `pet.png` if idle also fails. Dragging takes priority over one-shot actions.
- Walking cadence follows movement speed with a gentler increase at higher speeds.

Settings → Behavior includes the interaction controls; character scale is under Appearance:

| Setting | Default | Range / behavior |
| --- | --- | --- |
| Auto-sit | On | Suspend roaming after inactivity |
| Auto-sit delay | 60 seconds | 15–600 seconds |
| Interaction bubbles | On | One bubble at a time, 2.6 seconds |
| Click to heart | On | Play the heart animation for “爱你哦~” |
| Character scale | 100% | 60%–150%, proportional |
| Roaming speed | 30 DIP/s | 10–120 DIP/s |

Settings schema v2 automatically fills in new fields while preserving v1 preferences. Runtime actions and the inactivity countdown start fresh on launch; the existing “start roaming on launch” setting controls startup roaming.

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

The DMG is written to `release/`; the app is written to `release/v0.6.0/mac-arm64/Pixel Pet.app`. Older version directories and DMGs are preserved. Rebuilding the same version archives its previous DMG with a timestamp. The installer is named `PixelPet-0.6.0-arm64.dmg`. Each build also copies `Allow-PixelPet.command` to `release/` so it can be distributed alongside the DMG.

## Install and Open for the First Time

1. Download `PixelPet-0.6.0-arm64.dmg` and, if provided, `Allow-PixelPet.command` from the trusted release source.
2. Quit any running copy of Pixel Pet. Open the DMG and drag `Pixel Pet.app` onto the **Applications** shortcut. When updating, replace the installed copy.
3. If you downloaded the companion script, double-click `Allow-PixelPet.command` after installing the app. Terminal opens and a confirmation dialog appears. Review the message and click **Continue** only if you trust this release.
4. When the script reports success, click **OK**. Its standalone Terminal window closes automatically; Terminal also quits if no other windows remain. Then open Pixel Pet from **Applications**. The script does not launch the app for you.

The script only removes download quarantine from `/Applications/Pixel Pet.app`, checks the app's bundle identifier, and does not use `sudo`. It does not sign the app or disable Gatekeeper globally. If you cancel or an error occurs, the dialog explains the result before the script exits. You may need to run it again after replacing the app with a new version.

Automatic window closing requires Apple's Terminal app and permission to control Terminal if macOS requests it. Windows containing other tabs are kept open. If permission is denied or another terminal app is used, close the script's window manually after it finishes.

A downloaded `.command` file may itself be blocked by macOS, so this method does not guarantee a prompt-free first run. If macOS blocks the app or script, try opening it once, then check **System Settings → Privacy & Security → Open Anyway** if that option appears.

If macOS reports that the app is “damaged” and the approval option is unavailable, confirm that the DMG came from a trusted source. You can then remove the download quarantine attribute from this app only:

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
| `electron/interaction-controller.ts`, `electron/pet-state.ts` | Phrase-to-action mapping, inactivity, bubble timing, and shared action state |
| `src/bubble-main.tsx`, `src/bubble.css`, `bubble.html` | Pixel-art bubble view and tail direction |
| `src/main.tsx`, `src/animation-system.ts` | Pet rendering and frame-based animation |
| `src/settings-main.tsx`, `src/settings.css`, `settings.html` | Standalone settings window |
| `public/` | Character image and animation assets |
| `assets/` | App and menu bar template icons |

## Verification

Run `npm test` for deterministic controller, settings, and display geometry regressions.

## License

This repository does not currently declare an open-source license. Before public reuse or redistribution, add an appropriate LICENSE file and confirm the licensing terms for the character art and other assets.
