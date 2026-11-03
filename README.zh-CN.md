# Pixel Pet

**macOS 像素桌宠，使用 Electron、TypeScript、React 和 Vite 构建。** 桌宠支持逐帧动作、桌面漫步、菜单栏控制、独立设置面板和位置记忆。

[English](README.md)

<p align="left">
  <img src="assets/demo.gif" height="180" alt="Pixel Pet 演示">
</p>

## 功能

- 透明、无边框、始终置顶的桌宠窗口
- idle、walk、heart 等逐帧动画
- 自主漫步、随机停留、屏幕边缘检测和转向
- 菜单栏控制、独立设置面板、动画暂停和位置锁定
- 本地设置与桌宠位置记忆
- 通过安全 preload / IPC 在渲染进程与 Electron 主进程间通信

## 开发运行

```sh
npm install
npm run dev
```

按 `⌘Q` 或从菜单栏选择「退出应用」退出。关闭设置窗口只会关闭设置面板；关闭桌宠窗口会隐藏桌宠，可通过菜单栏重新显示。

## 构建 macOS 测试版

当前构建面向 Apple Silicon（`arm64`）。在 macOS 上运行：

```sh
npm run build:icons
npm run package:mac
```

应用和 DMG 输出在 `release/`。打包脚本会清理旧的中间 `.app` 和 DMG staging 目录，但保留已有 DMG。测试安装包文件名带有 `unsigned`，并自动生成 SHA256 文件。

## 安装和首次打开

1. 下载 `Pixel Pet-1.0.0-arm64-unsigned.dmg`，并核对随附的 `.sha256` 文件。
2. 双击 DMG，将 `Pixel Pet.app` 拖到 `Applications` 快捷方式。
3. 从「应用程序」中尝试打开 Pixel Pet。
4. 如果 macOS 阻止打开，前往「系统设置 → 隐私与安全性」，在安全性区域选择针对 Pixel Pet 的「仍要打开 / Open Anyway」，确认后再次打开应用。

如果 macOS 显示「文件已损坏」且上述授权入口不可用，请先确认 DMG 来源可信且 SHA256 匹配。之后可以只移除该应用的下载隔离标记：

```sh
xattr -dr com.apple.quarantine "/Applications/Pixel Pet.app"
```

然后再次打开应用。此命令只处理 Pixel Pet，不会关闭或全局降低 Gatekeeper。如果应用仍无法启动，请停止运行并联系发布者，不要尝试关闭系统安全功能。

Apple 的说明：[在 Mac 上安全地打开 App](https://support.apple.com/en-us/102445)。

## 签名与安全限制

此 DMG 是**未签名、未公证的个人测试构建**：项目没有 Apple Developer ID 证书或公证凭据。配置为 `identity: null`、`hardenedRuntime: false`、`notarize: false`、`forceCodeSigning: false`；打包脚本关闭签名身份自动发现并清除已知的 `CSC_*` / `APPLE_*` 签名与公证凭据变量。没有使用 `identity: "-"` 对整个应用包进行 Ad-hoc 签名。

检查结果：应用包没有 Team ID，也没有 `Contents/_CodeSignature` 资源封印目录。Electron 的 arm64 主可执行文件自身带有链接器生成的 `adhoc,linker-signed` CodeDirectory；这不是 Developer ID 签名，也不是 electron-builder 对整个应用包所做的 Ad-hoc 签名。严格的 `codesign --verify --deep --strict` 校验会因这个未签名包没有资源封印而失败。实际构建已通过 macOS UI 启动并显示桌宠。

未签名应用无法让其他 Mac 自动验证发布者身份或由 Apple 检查恶意软件，因此 Gatekeeper 可能阻止首次运行。手动批准表示用户选择继续运行，并不代表应用已获得 Apple 签名或公证。正式公开分发应使用 Developer ID 签名并完成 Apple 公证。

当前 DMG 只包含 Apple Silicon `arm64` 构建，不适用于 Intel Mac。未签名测试构建的 macOS 登录启动功能也不保证可靠。

## SHA256 校验

DMG 旁边的 `Pixel Pet-1.0.0-arm64-unsigned.dmg.sha256` 包含 SHA256 摘要。下载 DMG 和 sidecar 文件后，在 Terminal 中运行：

```sh
cd ~/Downloads
shasum -a 256 -c "Pixel Pet-1.0.0-arm64-unsigned.dmg.sha256"
```

显示 `OK` 表示文件内容与摘要匹配。发布者应通过独立且可信的渠道提供摘要，避免 DMG 和摘要一起被替换。

## 设置和本地数据

设置面板包含常规、外观和行为分类。设置变更会立即写入 Electron `userData` 目录：

- `settings.json`：带 schema 版本的应用设置
- `pet-window.json`：桌宠窗口位置

主进程是配置的唯一写入者。渲染进程通过 preload 暴露的类型化 IPC 访问有限字段；`contextIsolation` 保持开启，渲染进程不能直接访问 Node.js。

## 主要模块

| 文件/目录 | 职责 |
| --- | --- |
| `electron/main.ts` | Tray、窗口、菜单、登录项、Dock 和 IPC |
| `electron/settings-store.ts`、`electron/settings-types.ts` | 版本化配置与校验 |
| `electron/wander-controller.ts` | 桌宠窗口移动与漫步控制 |
| `src/main.tsx`、`src/animation-system.ts` | 桌宠渲染与逐帧动画 |
| `src/settings-main.tsx`、`src/settings.css`、`settings.html` | 独立设置窗口 |
| `public/` | 角色图片与动画素材 |
| `assets/` | 应用图标与菜单栏模板图标 |

## 许可

本仓库当前未声明开源许可证。公开复用或再分发前，请添加适当的 LICENSE，并确认角色图片及其他素材的授权范围。
