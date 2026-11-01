import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, Rectangle } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WanderController, type Facing, type WanderMode, type WanderWindow } from './wander-controller.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEV_URL = 'http://127.0.0.1:5173';
const WINDOW_WIDTH = 160;
const WINDOW_HEIGHT = 220;
const DEFAULT_MARGIN = 24;
const POSITION_FILE = () => join(app.getPath('userData'), 'pet-window.json');
type MainMode = WanderMode | 'wave' | 'dragging';

let petWindow: BrowserWindow | null = null;
let paused = false;
let locked = false;
let animationMode: MainMode = 'idle';
let facing: Facing = 'right';
let dragOrigin: { pointerX: number; pointerY: number; windowX: number; windowY: number } | null = null;
let savePositionTimer: ReturnType<typeof setTimeout> | undefined;
let wanderController: WanderController | null = null;

type ScreenPoint = { screenX: number; screenY: number };

function isAppSender(event: IpcMainEvent | IpcMainInvokeEvent) {
  const url = event.senderFrame?.url;
  if (typeof url !== 'string' || event.senderFrame !== event.sender.mainFrame) return false;
  try {
    const source = new URL(url);
    if (!app.isPackaged) return source.origin === new URL(DEV_URL).origin;
    const expectedPath = new URL(pathToFileURL(join(__dirname, '../dist/index.html')).href).pathname;
    return source.protocol === 'file:' && source.pathname === expectedPath;
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

function sendUiState() {
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:ui-state', getUiState());
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

function getDefaultPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + Math.max(0, workArea.width - WINDOW_WIDTH - DEFAULT_MARGIN),
    y: workArea.y + Math.max(0, workArea.height - WINDOW_HEIGHT - DEFAULT_MARGIN),
  };
}

function readSavedPosition() {
  try {
    const path = POSITION_FILE();
    if (!existsSync(path)) return getDefaultPosition();
    const value = JSON.parse(readFileSync(path, 'utf8')) as { x?: unknown; y?: unknown };
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return getDefaultPosition();
    return clampToVisibleDisplay({ x: value.x as number, y: value.y as number, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
  } catch {
    return getDefaultPosition();
  }
}

function createContextMenu() {
  const roaming = wanderController?.isEnabled ?? false;
  return Menu.buildFromTemplate([
    { label: paused ? '恢复动画' : '暂停动画', click: () => { paused = !paused; wanderController?.setPaused(paused); sendUiState(); } },
    {
      label: roaming ? '停止自主漫步' : '开始自主漫步',
      enabled: roaming || (!locked && !dragOrigin),
      click: () => {
        if (roaming) wanderController?.stop();
        else if (!locked) {
          if (savePositionTimer) clearTimeout(savePositionTimer);
          savePositionTimer = undefined;
          wanderController?.start();
        }
        sendUiState();
      },
    },
    { label: locked ? '解除位置锁定' : '锁定位置', click: () => {
      locked = !locked;
      if (locked) {
        wanderController?.stop();
        if (dragOrigin) {
          dragOrigin = null;
          animationMode = 'idle';
          savePosition();
        }
      }
      sendUiState();
    } },
    { type: 'separator' },
    { label: '恢复默认位置', click: () => {
      wanderController?.stop();
      dragOrigin = null;
      animationMode = 'idle';
      const position = getDefaultPosition();
      petWindow?.setPosition(position.x, position.y);
      savePosition();
    } },
    { type: 'separator' },
    { label: '退出桌宠', click: () => app.quit() },
  ]);
}

function createWindow() {
  const position = readSavedPosition();
  const window = new BrowserWindow({
    x: position.x,
    y: position.y,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  petWindow = window;
  window.setAlwaysOnTop(true, 'floating');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.on('move', scheduleSavePosition);
  window.on('closed', () => {
    if (petWindow === window) {
      wanderController?.stop();
      petWindow = null;
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
ipcMain.on('pet:set-roaming', (event, enabled: unknown) => {
  if (!isAppSender(event) || typeof enabled !== 'boolean' || !petWindow || event.sender !== petWindow.webContents) return;
  if (enabled && !locked && !dragOrigin) {
    if (savePositionTimer) clearTimeout(savePositionTimer);
    savePositionTimer = undefined;
    wanderController?.start();
  } else {
    wanderController?.stop();
  }
  sendUiState();
});
ipcMain.on('pet:wave-start', (event) => {
  if (!isAppSender(event) || !petWindow || event.sender !== petWindow.webContents || paused) return;
  wanderController?.beginWave();
  animationMode = 'wave';
  sendUiState();
});
ipcMain.on('pet:wave-finish', (event) => {
  if (!isAppSender(event) || !petWindow || event.sender !== petWindow.webContents) return;
  wanderController?.finishWave();
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
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
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
  const screenPort = screen as unknown as ConstructorParameters<typeof WanderController>[0];
  const windowPort = () => petWindow as unknown as WanderWindow | null;
  wanderController = new WanderController(screenPort, {
    getWindow: windowPort,
    isLocked: () => locked,
    onModeChange: (mode: WanderMode | 'wave') => { animationMode = mode; sendUiState(); },
    onFacingChange: (direction: Facing) => { facing = direction; sendUiState(); },
    onEnabledChange: sendUiState,
    persistPosition: savePosition,
  });
  screen.on('display-added', handleDisplayConfigurationChanged);
  screen.on('display-removed', handleDisplayConfigurationChanged);
  screen.on('display-metrics-changed', handleDisplayConfigurationChanged);
  displayEventsRegistered = true;
  createWindow();
});
app.on('before-quit', () => {
  wanderController?.dispose();
  removeDisplayListeners();
  if (savePositionTimer) clearTimeout(savePositionTimer);
  savePositionTimer = undefined;
  savePosition();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
