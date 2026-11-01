import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, Rectangle } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WanderController, WANDER_CONFIG, type ActionMode, type Facing, type WanderMode, type WanderWindow } from './wander-controller.js';
import { SettingsStore } from './settings-store.js';
import { DEFAULT_APP_SETTINGS, validateSettingsPatch, type AppSettings, type AppSettingsPatch, type AppSnapshot } from './settings-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.PIXEL_PET_DEV_URL ?? 'http://127.0.0.1:5173';
const WINDOW_WIDTH = 160;
const WINDOW_HEIGHT = 220;
const DEFAULT_MARGIN = 24;
if (process.platform === 'darwin') app.setPath('userData', join(app.getPath('appData'), 'pixel-pet'));
const POSITION_FILE = () => join(app.getPath('userData'), 'pet-window.json');
const SETTINGS_FILE = () => join(app.getPath('userData'), 'settings.json');
type MainMode = WanderMode | ActionMode | 'dragging';

let petWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let settingsStore: SettingsStore;
let settings: AppSettings = { ...DEFAULT_APP_SETTINGS };
let paused = false;
let locked = false;
let animationMode: MainMode = 'idle';
let facing: Facing = 'right';
let dragOrigin: { pointerX: number; pointerY: number; windowX: number; windowY: number } | null = null;
let savePositionTimer: ReturnType<typeof setTimeout> | undefined;
let wanderController: WanderController | null = null;
let isQuitting = false;

type ScreenPoint = { screenX: number; screenY: number };

function isAppSender(event: IpcMainEvent | IpcMainInvokeEvent) {
  const url = event.senderFrame?.url;
  if (typeof url !== 'string' || event.senderFrame !== event.sender.mainFrame) return false;
  try {
    const source = new URL(url);
    if (!app.isPackaged) return source.origin === new URL(DEV_URL).origin;
    const expectedPaths = ['index.html', 'settings.html'].map((file) =>
      new URL(pathToFileURL(join(__dirname, `../dist/${file}`)).href).pathname,
    );
    return source.protocol === 'file:' && expectedPaths.includes(source.pathname);
  } catch {
    return false;
  }
}

function isScreenPoint(value: unknown): value is ScreenPoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as Record<string, unknown>;
  return Number.isFinite(point.screenX) && Number.isFinite(point.screenY)
    && Math.abs(point.screenX as number) < 1_000_000 && Math.abs(point.screenY as number) < 1_000_000;
}

function getUiState() {
  return {
    paused,
    locked,
    roaming: wanderController?.isEnabled ?? false,
    mode: animationMode,
    direction: facing,
  };
}

function getAppSnapshot(): AppSnapshot {
  return {
    settings: { ...settings },
    runtime: {
      petVisible: Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible()),
      roaming: wanderController?.isEnabled ?? false,
      paused,
      locked,
      launchAtLogin: process.platform === 'darwin' ? app.getLoginItemSettings().openAtLogin : settings.launchAtLogin,
    },
  };
}

function sendUiState() {
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:ui-state', getUiState());
  refreshTrayMenu();
}

function broadcastSnapshot() {
  const snapshot = getAppSnapshot();
  for (const window of [petWindow, settingsWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('app:snapshot-changed', snapshot);
  }
  refreshTrayMenu();
}

function startPetAction(mode: ActionMode) {
  if (paused || !petWindow || petWindow.isDestroyed()) return;
  wanderController?.beginAction(mode);
  animationMode = mode;
  sendUiState();
}

function savePosition() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const [x, y] = petWindow.getPosition();
  try { writeFileSync(POSITION_FILE(), JSON.stringify({ x, y }), 'utf8'); }
  catch (error) { console.error('Could not save pet position:', error); }
}

function scheduleSavePosition() {
  if (wanderController?.isEnabled || dragOrigin) return;
  if (savePositionTimer) clearTimeout(savePositionTimer);
  savePositionTimer = setTimeout(() => { savePositionTimer = undefined; savePosition(); }, 250);
}

function clampToVisibleDisplay(bounds: Rectangle) {
  const center = { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) };
  const workArea = screen.getDisplayNearestPoint(center).workArea;
  const maxX = workArea.x + Math.max(0, workArea.width - bounds.width);
  const maxY = workArea.y + Math.max(0, workArea.height - bounds.height);
  return {
    x: Math.min(Math.max(bounds.x, workArea.x), maxX),
    y: Math.min(Math.max(bounds.y, workArea.y), maxY),
  };
}

function getPetDimensions(scalePercent = settings.petScalePercent) {
  const scale = scalePercent / 100;
  return { width: Math.round(WINDOW_WIDTH * scale), height: Math.round(WINDOW_HEIGHT * scale) };
}

function getDefaultPosition(width: number, height: number) {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + Math.max(0, workArea.width - width - DEFAULT_MARGIN),
    y: workArea.y + Math.max(0, workArea.height - height - DEFAULT_MARGIN),
  };
}

function readSavedPosition(width: number, height: number) {
  try {
    const path = POSITION_FILE();
    if (!existsSync(path)) return getDefaultPosition(width, height);
    const value = JSON.parse(readFileSync(path, 'utf8')) as { x?: unknown; y?: unknown };
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return getDefaultPosition(width, height);
    return clampToVisibleDisplay({ x: value.x as number, y: value.y as number, width, height });
  } catch {
    return getDefaultPosition(width, height);
  }
}

function configuredWanderValues() {
  return {
    speedDipPerSecond: settings.roamingSpeedDipPerSecond,
    minWalkMs: settings.minWalkSeconds * 1_000,
    maxWalkMs: settings.maxWalkSeconds * 1_000,
    minRestMs: settings.minRestSeconds * 1_000,
    maxRestMs: settings.maxRestSeconds * 1_000,
  };
}

function setPetVisible(visible: boolean, persist = true) {
  if (visible) {
    if (!petWindow || petWindow.isDestroyed()) createPetWindow();
    petWindow?.show();
    if (settings.alwaysOnTop) petWindow?.setAlwaysOnTop(true, 'floating');
  } else {
    if (wanderController?.isEnabled) wanderController.stop();
    petWindow?.hide();
  }
  if (persist && settings.showPet !== visible) settings = settingsStore.update({ showPet: visible });
  broadcastSnapshot();
}

function setRoaming(enabled: boolean) {
  if (enabled) {
    if (settings.allowAutonomousRoaming && !locked && petWindow?.isVisible()) {
      if (savePositionTimer) clearTimeout(savePositionTimer);
      savePositionTimer = undefined;
      wanderController?.start();
    }
  } else {
    wanderController?.stop();
  }
  sendUiState();
  broadcastSnapshot();
}

function setPaused(value: boolean) {
  paused = value;
  wanderController?.setPaused(value);
  sendUiState();
  broadcastSnapshot();
}

function applyScaleChange(previousPercent: number) {
  if (!petWindow || petWindow.isDestroyed() || previousPercent === settings.petScalePercent) return;
  const oldBounds = petWindow.getBounds();
  const { width, height } = getPetDimensions();
  const left = oldBounds.x + oldBounds.width / 2 - width / 2;
  const top = oldBounds.y + oldBounds.height - height;
  const target = clampToVisibleDisplay({ x: left, y: top, width, height });
  petWindow.setBounds({ x: Math.round(target.x), y: Math.round(target.y), width, height });
  savePosition();
}

function applySettings(previous: AppSettings) {
  if (settings.alwaysOnTop !== previous.alwaysOnTop && petWindow && !petWindow.isDestroyed()) {
    petWindow.setAlwaysOnTop(settings.alwaysOnTop, settings.alwaysOnTop ? 'floating' : 'normal');
  }
  applyScaleChange(previous.petScalePercent);
  wanderController?.configure(configuredWanderValues());
  if (!settings.allowAutonomousRoaming && wanderController?.isEnabled) wanderController.stop();

  if (settings.showDockIcon !== previous.showDockIcon && process.platform === 'darwin' && app.dock) {
    if (settings.showDockIcon) app.dock.show();
    else app.dock.hide();
  }
  if (settings.showMenuBarIcon !== previous.showMenuBarIcon) {
    if (settings.showMenuBarIcon) createTray();
    else destroyTray();
  }
  if (settings.launchAtLogin !== previous.launchAtLogin && process.platform === 'darwin') {
    try {
      app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
      if (app.isPackaged) {
        const actual = app.getLoginItemSettings().openAtLogin;
        if (settings.launchAtLogin !== actual) settings = settingsStore.update({ launchAtLogin: actual });
      }
    }
    catch (error) { console.warn('Could not configure macOS login item:', error); }
  }
  if (settings.showPet !== previous.showPet) setPetVisible(settings.showPet, false);
  else broadcastSnapshot();
}

function updateSettings(patch: AppSettingsPatch) {
  const previous = settings;
  settings = settingsStore.update(patch);
  applySettings(previous);
  return getAppSnapshot();
}

function resetSettings() {
  const previous = settings;
  settings = settingsStore.reset();
  applySettings(previous);
  return getAppSnapshot();
}

function showSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  const window = new BrowserWindow({
    width: 760,
    height: 640,
    minWidth: 700,
    minHeight: 560,
    title: 'Pixel Pet 设置',
    backgroundColor: '#f5f5f7',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow = window;
  window.on('ready-to-show', () => { window.show(); broadcastSnapshot(); });
  window.on('closed', () => { if (settingsWindow === window) settingsWindow = null; });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      const target = new URL(targetUrl);
      const allowed = app.isPackaged
        ? target.protocol === 'file:' && target.pathname === new URL(pathToFileURL(join(__dirname, '../dist/settings.html')).href).pathname
        : target.origin === new URL(DEV_URL).origin;
      if (!allowed) event.preventDefault();
    } catch { event.preventDefault(); }
  });
  if (!app.isPackaged) void window.loadURL(`${DEV_URL}/settings.html`);
  else void window.loadFile(join(__dirname, '../dist/settings.html'));
}

function buildTrayMenu() {
  const roaming = wanderController?.isEnabled ?? false;
  const visible = Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible());
  return Menu.buildFromTemplate([
    { label: '显示桌宠', enabled: !visible, click: () => setPetVisible(true) },
    { label: '隐藏桌宠', enabled: visible, click: () => setPetVisible(false) },
    { type: 'separator' },
    {
      label: roaming ? '关闭自主漫步' : '开启自主漫步',
      enabled: roaming || (settings.allowAutonomousRoaming && !locked && visible),
      click: () => setRoaming(!roaming),
    },
    { label: paused ? '恢复动画' : '暂停动画', click: () => setPaused(!paused) },
    { type: 'separator' },
    { label: '打开设置', click: showSettingsWindow },
    { type: 'separator' },
    { label: '退出应用', click: () => app.quit() },
  ]);
}

function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  if (tray && !tray.isDestroyed()) return;
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'PixelPetTemplate.png')
    : join(__dirname, '../assets/PixelPetTemplate.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) console.error(`Tray image could not be loaded: ${iconPath}`);
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Pixel Pet');
  refreshTrayMenu();
  tray.on('click', () => tray?.popUpContextMenu());
  tray.on('right-click', () => tray?.popUpContextMenu());
}

function destroyTray() {
  if (!tray || tray.isDestroyed()) { tray = null; return; }
  tray.destroy();
  tray = null;
}

function installApplicationMenu() {
  if (process.platform !== 'darwin') return;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { role: 'quit', accelerator: 'Command+Q' },
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]));
}

function createContextMenu() {
  const roaming = wanderController?.isEnabled ?? false;
  return Menu.buildFromTemplate([
    { label: paused ? '恢复动画' : '暂停动画', click: () => setPaused(!paused) },
    { label: '比心', enabled: !paused && animationMode !== 'dragging', click: () => startPetAction('heart') },
    { label: roaming ? '停止自主漫步' : '开始自主漫步', enabled: roaming || (settings.allowAutonomousRoaming && !locked && !dragOrigin), click: () => setRoaming(!roaming) },
    { label: locked ? '解除位置锁定' : '锁定位置', click: () => {
      locked = !locked;
      if (locked && wanderController?.isEnabled) wanderController.stop();
      if (locked && dragOrigin) { dragOrigin = null; animationMode = 'idle'; savePosition(); }
      sendUiState(); broadcastSnapshot();
    } },
    { type: 'separator' },
    { label: '恢复默认位置', click: () => {
      wanderController?.stop();
      dragOrigin = null;
      animationMode = 'idle';
      const { width, height } = getPetDimensions();
      const position = getDefaultPosition(width, height);
      petWindow?.setPosition(position.x, position.y);
      savePosition();
    } },
    { label: '打开设置', click: showSettingsWindow },
    { type: 'separator' },
    { label: '隐藏桌宠', click: () => setPetVisible(false) },
  ]);
}

function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) return petWindow;
  const { width, height } = getPetDimensions();
  const position = readSavedPosition(width, height);
  const window = new BrowserWindow({
    x: position.x,
    y: position.y,
    width,
    height,
    transparent: true,
    frame: false,
    alwaysOnTop: settings.alwaysOnTop,
    resizable: false,
    hasShadow: false,
    show: settings.showPet,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  petWindow = window;
  if (settings.alwaysOnTop) window.setAlwaysOnTop(true, 'floating');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.on('move', scheduleSavePosition);
  window.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    setPetVisible(false);
  });
  window.on('closed', () => {
    if (petWindow === window) {
      wanderController?.stop();
      petWindow = null;
      broadcastSnapshot();
    }
  });
  window.webContents.on('dom-ready', sendUiState);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      const target = new URL(targetUrl);
      const allowed = app.isPackaged
        ? target.protocol === 'file:' && target.pathname === new URL(pathToFileURL(join(__dirname, '../dist/index.html')).href).pathname
        : target.origin === new URL(DEV_URL).origin;
      if (!allowed) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  if (!app.isPackaged) void window.loadURL(DEV_URL);
  else void window.loadFile(join(__dirname, '../dist/index.html'));
  return window;
}

function handleDisplayConfigurationChanged() {
  if (wanderController?.isEnabled) {
    if (savePositionTimer) clearTimeout(savePositionTimer);
    savePositionTimer = undefined;
  }
  wanderController?.onDisplayConfigurationChanged();
  if (!wanderController?.isEnabled) {
    if (petWindow && !petWindow.isDestroyed()) {
      const clamped = clampToVisibleDisplay(petWindow.getBounds());
      petWindow.setPosition(clamped.x, clamped.y);
    }
    savePosition();
  }
  sendUiState();
}

ipcMain.handle('pet:get-ui-state', (event) => {
  if (!isAppSender(event)) throw new Error('Untrusted renderer');
  return getUiState();
});
ipcMain.handle('app:get-snapshot', (event) => {
  if (!isAppSender(event)) throw new Error('Untrusted renderer');
  return getAppSnapshot();
});
ipcMain.handle('app:update-settings', (event, patch: unknown) => {
  if (!isAppSender(event) || !validateSettingsPatch(patch)) throw new Error('Invalid settings update');
  return updateSettings(patch);
});
ipcMain.handle('app:reset-settings', (event) => {
  if (!isAppSender(event)) throw new Error('Untrusted renderer');
  return resetSettings();
});
ipcMain.on('app:open-settings', (event) => {
  if (!isAppSender(event)) return;
  showSettingsWindow();
});
ipcMain.on('app:set-pet-visible', (event, visible: unknown) => {
  if (!isAppSender(event) || typeof visible !== 'boolean') return;
  setPetVisible(visible);
});
ipcMain.on('app:set-roaming', (event, enabled: unknown) => {
  if (!isAppSender(event) || typeof enabled !== 'boolean') return;
  setRoaming(enabled);
});
ipcMain.on('pet:set-roaming', (event, enabled: unknown) => {
  if (!isAppSender(event) || typeof enabled !== 'boolean' || !petWindow || event.sender !== petWindow.webContents) return;
  if (enabled && dragOrigin) return;
  setRoaming(enabled);
});
ipcMain.on('pet:action-start', (event, mode: unknown) => {
  if (!isAppSender(event) || !petWindow || event.sender !== petWindow.webContents
    || (mode !== 'wave' && mode !== 'heart')) return;
  if (mode === 'heart' && !settings.allowClickHeart) return;
  startPetAction(mode);
});
ipcMain.on('pet:action-finish', (event) => {
  if (!isAppSender(event) || !petWindow || event.sender !== petWindow.webContents) return;
  wanderController?.finishAction();
  if (!wanderController?.isEnabled) animationMode = 'idle';
  sendUiState();
});
ipcMain.on('pet:show-context-menu', (event) => {
  if (!isAppSender(event) || !petWindow || event.sender !== petWindow.webContents) return;
  createContextMenu().popup({ window: petWindow });
});
ipcMain.on('pet:begin-drag', (event, point: unknown) => {
  if (!isAppSender(event) || locked || !isScreenPoint(point) || !petWindow || event.sender !== petWindow.webContents) return;
  wanderController?.onManualDragStarted();
  const [windowX, windowY] = petWindow.getPosition();
  dragOrigin = { pointerX: point.screenX, pointerY: point.screenY, windowX, windowY };
  animationMode = 'dragging';
  sendUiState();
});
ipcMain.on('pet:drag-to', (event, point: unknown) => {
  if (!isAppSender(event) || locked || !isScreenPoint(point) || !dragOrigin || !petWindow || event.sender !== petWindow.webContents) return;
  const bounds = {
    x: dragOrigin.windowX + point.screenX - dragOrigin.pointerX,
    y: dragOrigin.windowY + point.screenY - dragOrigin.pointerY,
    width: petWindow.getBounds().width,
    height: petWindow.getBounds().height,
  };
  const position = clampToVisibleDisplay(bounds);
  petWindow.setPosition(Math.round(position.x), Math.round(position.y));
});
ipcMain.on('pet:end-drag', (event) => {
  if (!isAppSender(event) || !dragOrigin || !petWindow || event.sender !== petWindow.webContents) return;
  dragOrigin = null;
  wanderController?.onManualDragEnded();
  animationMode = wanderController?.isEnabled ? wanderController.currentMode : 'idle';
  sendUiState();
});
let displayEventsRegistered = false;
function removeDisplayListeners() {
  if (!displayEventsRegistered) return;
  screen.removeListener('display-added', handleDisplayConfigurationChanged);
  screen.removeListener('display-removed', handleDisplayConfigurationChanged);
  screen.removeListener('display-metrics-changed', handleDisplayConfigurationChanged);
  displayEventsRegistered = false;
}

app.whenReady().then(() => {
  installApplicationMenu();
  settingsStore = new SettingsStore(SETTINGS_FILE());
  settings = settingsStore.value;
  if (process.platform === 'darwin') {
    const actual = app.getLoginItemSettings().openAtLogin;
    if (app.isPackaged && settings.launchAtLogin !== actual) settings = settingsStore.update({ launchAtLogin: actual });
    if (settings.launchAtLogin && !actual) {
      try { app.setLoginItemSettings({ openAtLogin: true }); }
      catch (error) { console.warn('Could not configure macOS login item:', error); }
    }
    if (app.dock) {
      if (settings.showDockIcon) app.dock.show();
      else app.dock.hide();
    }
  }
  const screenPort = screen as unknown as ConstructorParameters<typeof WanderController>[0];
  const windowPort = () => petWindow as unknown as WanderWindow | null;
  wanderController = new WanderController(screenPort, {
    getWindow: windowPort,
    isLocked: () => locked,
    onModeChange: (mode: WanderMode | ActionMode) => { animationMode = mode; sendUiState(); },
    onFacingChange: (direction: Facing) => { facing = direction; sendUiState(); },
    onEnabledChange: sendUiState,
    persistPosition: savePosition,
  });
  wanderController.configure(configuredWanderValues());
  screen.on('display-added', handleDisplayConfigurationChanged);
  screen.on('display-removed', handleDisplayConfigurationChanged);
  screen.on('display-metrics-changed', handleDisplayConfigurationChanged);
  displayEventsRegistered = true;
  createPetWindow();
  if (settings.showMenuBarIcon) createTray();
  if (settings.autoStartRoaming && settings.allowAutonomousRoaming && settings.showPet) setRoaming(true);
  broadcastSnapshot();
});
app.on('before-quit', () => {
  isQuitting = true;
  wanderController?.dispose();
  removeDisplayListeners();
  if (savePositionTimer) clearTimeout(savePositionTimer);
  savePositionTimer = undefined;
  savePosition();
  destroyTray();
});
app.on('window-all-closed', () => { /* Tray or Dock actions keep the application available. */ });
app.on('activate', () => setPetVisible(true));
