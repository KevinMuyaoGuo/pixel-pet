🇬🇧English

# Pixel Pet

**A pixel-art desktop companion for macOS, built with Electron and React.**

**Pixel Pet uses the Electron main process to manage system windows, the menu bar, desktop roaming, and local settings. The React renderer displays the desktop pet and its standalone settings window.**

## Features

* **Desktop pet window** — displays the pixel-art companion on your macOS desktop.
* **Menu bar controls** — manage the app from the macOS menu bar.
* **Desktop roaming** — the main process controls the pet's roaming behavior independently of its visual animation.
* **Settings window** — configure general, appearance, and behavior settings in a separate window.
* **Persistent local settings** — setting changes are saved to a local JSON file.
* **Window position memory** — the pet's window position is stored locally.
* **Frame-based animation** — the renderer handles the pet display and animation system.

## Run Locally

**Install the dependencies and start the development app:**

```
npm install
npm run dev
```

To quit the app, press `⌘Q` or choose **Quit** from the menu bar menu.

**Closing the settings window only closes the settings panel. Closing the desktop pet window hides the pet; you can show it again from the menu bar.**

## Build for macOS

**The following commands generate the app icons and package the macOS app:**

```
npm run build:icons
npm run package:mac
```

The build targets **Apple Silicon (`arm64`)**. The generated `.app` and `.dmg` files are written to the `release/` directory.

**To install:**

1. **Open the generated DMG file.**
2. Drag `Pixel Pet.app` onto the **Applications** shortcut.
3. **Launch Pixel Pet from Applications.**

**The repository includes the app icon, an 18 px menu bar template icon, and a 36 px Retina version. You can regenerate these icons with **`scripts/generate-icons.swift`. This script does not read or modify the character artwork.

## Distribution and macOS Security

The current build is intended for **local testing**, not public distribution.

**This project does not currently include an Apple Developer ID certificate or notarization credentials. Code signing and the Hardened Runtime are disabled for this build. As a result, Gatekeeper may prevent the app from opening on other Macs.**

A build intended for public distribution requires a valid **Developer ID application signature** and **Apple notarization**.

### Login at Startup

Pixel Pet uses Electron's `app.setLoginItemSettings` to configure login startup.

**Login startup is not guaranteed to work for unsigned and non-notarized development or test builds. The Settings window shows the saved startup preference separately from the login-item status reported by macOS. Validate this feature using a signed and notarized build.**

## Settings and Local Data

Open the Settings window from **Open Settings** in the menu bar menu. Settings are organized into three sections:

* **General**
* **Appearance**
* **Behavior**

**Changes are written immediately to local JSON files. Restoring default settings does not delete the saved window-position file.**

Pixel Pet stores its local data in Electron's `userData` directory:


| **File**          | **Purpose**                                          |
| ----------------- | ---------------------------------------------------- |
| `settings.json`   | **Application settings, including a**`schemaVersion` |
| `pet-window.json` | **Desktop pet window position**                      |

The Electron main process is the only component that writes configuration. The desktop pet and settings renderer access limited, typed fields through IPC exposed by `preload`. `contextIsolation` remains enabled, and the renderer does not have access to Node.js APIs.

## Project Structure


| **File or directory**           | **Responsibility**                                                   |
| ------------------------------- | -------------------------------------------------------------------- |
| `electron/main.ts`              | **Tray, windows, menus, login items, Dock behavior, and secure IPC** |
| `electron/settings-store.ts`    | **Versioned settings storage**                                       |
| `electron/settings-types.ts`    | **Settings types and range validation**                              |
| `electron/wander-controller.ts` | **Window roaming logic, separated from visual animation**            |
| `src/main.tsx`                  | **Desktop pet renderer**                                             |
| `src/animation-system.ts`       | **Frame-based animation system**                                     |
| `src/settings-main.tsx`         | **Settings window renderer**                                         |
| `src/settings.css`              | **Settings window styles**                                           |
| `settings.html`                 | **Settings window entry point**                                      |
| `assets/`                       | **App icon and menu bar template icons**                             |

## Notes

* **The current macOS package targets Apple Silicon (**`arm64`).
* **The current package is unsigned and not notarized.**
* **Public distribution requires Developer ID signing and Apple notarization.**



🇨🇳中文

# Pixel Pet

macOS 像素桌宠：Electron 主进程管理系统窗口、菜单栏、漫步和本地设置；React 渲染桌宠与独立设置面板。

## 开发运行

```sh
npm install
npm run dev
```

退出应用可使用 `⌘Q` 或菜单栏图标菜单中的「退出应用」。关闭设置窗口只会关闭设置面板；关闭桌宠窗口会隐藏桌宠，可从菜单栏重新显示。

## macOS 打包

```sh
npm run build:icons
npm run package:mac
```

命令面向 Apple Silicon（arm64），生成未签名的本机测试 `.app` 和 `.dmg`，输出到 `release/`。打开 DMG 后将 `Pixel Pet.app` 拖到 `Applications` 快捷方式即可安装。仓库包含应用图标、18px 菜单栏 Template 图标和 36px Retina 版本；`scripts/generate-icons.swift` 可重新生成这些图标，不会读取或修改角色素材。

当前没有配置 Apple Developer ID 证书和公证凭据。构建关闭了代码签名和 Hardened Runtime，适合本机测试；不能作为正式发布版本分发，其他 Mac 可能会被 Gatekeeper 阻止。正式发布需要签名和公证。

macOS 登录启动使用 Electron 的 `app.setLoginItemSettings`。未签名、未公证的开发/测试应用不保证登录启动实际生效；设置页分别显示已保存的启动偏好与系统报告的登录项状态。请在签名、公证后的应用上验收此功能。

## 设置与用户数据

设置页由菜单栏「打开设置」打开，包含常规、外观和行为分类。设置变更立即写入本机 JSON 文件；恢复默认设置不会删除窗口位置文件。

- `app.getPath('userData')/settings.json`：带 `schemaVersion` 的应用设置。
- `app.getPath('userData')/pet-window.json`：桌宠窗口位置。

Electron 主进程是配置的唯一写入者。桌宠页与设置页只通过 `preload` 暴露的类型化 IPC 读写有限字段；`contextIsolation` 保持开启，渲染进程没有 Node.js 访问能力。

## 主要模块

- `electron/main.ts`：Tray、窗口、菜单、登录项、Dock 和安全 IPC。
- `electron/settings-store.ts`、`electron/settings-types.ts`：版本化配置和范围校验。
- `electron/wander-controller.ts`：与视觉动画分离的窗口漫步控制。
- `src/main.tsx`、`src/animation-system.ts`：桌宠渲染和逐帧动画。
- `src/settings-main.tsx`、`src/settings.css`、`settings.html`：独立设置面板。
- `assets/`：应用图标与菜单栏模板图标。
