# Pixel Pet

**macOS 像素桌宠，使用 Electron、TypeScript、React 和 Vite 构建。** 桌宠支持逐帧动作、桌面漫步、菜单栏控制、独立设置面板和位置记忆。

[English](README.md)

<p align="left">
  <img src="assets/demo.gif" height="180" alt="Pixel Pet 演示">
</p>

## 功能

- 透明、无边框、始终置顶的桌宠窗口
- 待机、行走、挥手、比心、坐下和站起的逐帧动画
- 自主漫步、随机停留、屏幕边缘检测和转向
- 菜单栏控制、独立设置面板、动画暂停和位置锁定
- 本地设置与桌宠位置记忆
- 通过安全 preload / IPC 在渲染进程与 Electron 主进程间通信

## v0.6 — 互动桌宠

- 左键点击人物会随机选一句话。「你好呀！」触发挥手，开启「点击人物触发比心」时，「爱你哦~」触发比心。其他句子只显示文字。挥手或比心期间连续点击会保留当前文案和动作，避免错配。
- 挥手以 4 fps 单次播放 6 帧，结束后回到待机。人物可见高度和脚底位置与待机对齐。若开启了自主漫步，停留后继续漫步。
- 像素风气泡跟随人物，同一时间只显示一条，约 2.6 秒后消失。人物靠近屏幕顶部时，气泡出现在下方，箭头朝上。鼠标可穿透气泡，键盘焦点保持在原处。
- 默认无互动 60 秒后暂停漫步，播放 4 帧坐下过渡并保持坐姿。鼠标拂过坐着的人物时，从当前帧倒放过渡，让人物站起。点击、拖拽、开启漫步或关闭自动坐下也会唤醒。暂停或播放一次性动作期间，自动坐下会延后。
- 坐姿素材缺失时使用站立待机帧，待机素材也无法加载时使用 `pet.png`。拖拽优先于一次性动作。
- 行走帧率随移动速度变化，高速段采用更平缓的加速幅度。

「设置 → 行为」中包含以下持久化选项；显示比例位于「外观」：

| 设置 | 默认值 | 范围 / 行为 |
| --- | --- | --- |
| 自动坐下 | 开启 | 无互动后暂停漫步并休息 |
| 自动坐下等待时间 | 60 秒 | 15～600 秒 |
| 互动气泡 | 开启 | 同时只显示一条，持续 2.6 秒 |
| 点击人物触发比心 | 开启 | 「爱你哦~」播放比心动画 |
| 显示比例 | 100% | 60%～150%，等比例缩放 |
| 漫步速度 | 30 DIP/s | 10～120 DIP/s |

设置 schema v2 会保留 v1 的已有偏好并补充新字段。应用重新启动时重置当前动作与空闲倒计时；是否自动漫步仍由已有的「启动应用后自动漫步」设置决定。

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

DMG 输出在 `release/`，应用输出在 `release/v0.6.0/mac-arm64/Pixel Pet.app`。旧版本目录和旧 DMG 均保留；重复构建同一版本时，会先为该版本的旧 DMG 添加时间戳归档。安装包文件名为 `PixelPet-0.6.0-arm64.dmg`。每次打包还会将 `Allow-PixelPet.command` 复制到 `release/`，方便随 DMG 一起发送。

## 安装和首次打开

1. 从可信的发布来源下载 `PixelPet-0.6.0-arm64.dmg`，以及发布者提供的 `Allow-PixelPet.command`（如有）。
2. 先退出正在运行的 Pixel Pet。双击 DMG，将 `Pixel Pet.app` 拖到 `Applications` 快捷方式；更新时选择替换已安装的版本。
3. 如果下载了配套脚本，安装完成后双击 `Allow-PixelPet.command`。终端会打开并显示确认弹窗；阅读说明，确认信任此版本后点击「继续」。
4. 脚本提示处理成功后，点击「好」。脚本所在的独立终端窗口会自动关闭；没有其他终端窗口时，终端应用也会退出。之后从「应用程序」打开 Pixel Pet。脚本不会自动启动桌宠。

脚本只移除 `/Applications/Pixel Pet.app` 的下载隔离标记，会校验应用标识，不使用 `sudo`，也不会对应用签名或关闭全局 Gatekeeper。取消或报错时，弹窗会说明结果，然后脚本退出。以后替换为新版本时，可能需要再次运行脚本。

自动关闭窗口需要使用 macOS 自带的「终端」，并在系统询问时允许控制「终端」。含有其他标签页的窗口会保留。如果未授予权限或使用其他终端应用，脚本结束后请手动关闭对应窗口。

下载的 `.command` 脚本自身也可能被 macOS 拦截，因此不能保证首次运行完全没有安全提示。如果应用或脚本被拦截，先尝试打开一次，再到「系统设置 → 隐私与安全性」查看是否出现「仍要打开 / Open Anyway」，如有则按提示确认。

如果 macOS 显示「文件已损坏」且上述授权入口不可用，请先确认 DMG 来源可信。之后可以只移除该应用的下载隔离标记：

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
| `electron/interaction-controller.ts`、`electron/pet-state.ts` | 文案与动作映射、空闲休息、气泡时序与共享动作状态 |
| `src/bubble-main.tsx`、`src/bubble.css`、`bubble.html` | 像素风气泡视图与箭头方向 |
| `src/main.tsx`、`src/animation-system.ts` | 桌宠渲染与逐帧动画 |
| `src/settings-main.tsx`、`src/settings.css`、`settings.html` | 独立设置窗口 |
| `public/` | 角色图片与动画素材 |
| `assets/` | 应用图标与菜单栏模板图标 |

## 验证

运行 `npm test` 可执行控制器、配置和显示区域几何的确定性回归测试。

## 许可

本仓库当前未声明开源许可证。公开复用或再分发前，请添加适当的 LICENSE，并确认角色图片及其他素材的授权范围。
