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
