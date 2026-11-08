import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettingsPatch, AppSnapshot } from './settings-types.js';
import type { PetUiState as UiState, BubbleState } from './pet-state.js';

type ScreenPoint = { screenX: number; screenY: number };

contextBridge.exposeInMainWorld('petBridge', {
  getUiState: (): Promise<UiState> => ipcRenderer.invoke('pet:get-ui-state'),
  setRoaming: (enabled: boolean) => ipcRenderer.send('pet:set-roaming', enabled),
  startAction: (mode: 'wave' | 'heart') => ipcRenderer.send('pet:action-start', mode),
  click: () => ipcRenderer.send('pet:click'),
  hover: (sitFrame: number | null) => ipcRenderer.send('pet:hover', sitFrame),
  finishAction: (actionId: number) => ipcRenderer.send('pet:action-finish', actionId),
  beginDrag: (point: ScreenPoint) => ipcRenderer.send('pet:begin-drag', point),
  dragTo: (point: ScreenPoint) => ipcRenderer.send('pet:drag-to', point),
  endDrag: () => ipcRenderer.send('pet:end-drag'),
  showContextMenu: () => ipcRenderer.send('pet:show-context-menu'),
  onUiState: (callback: (state: UiState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UiState) => callback(state);
    ipcRenderer.on('pet:ui-state', listener);
    return () => ipcRenderer.removeListener('pet:ui-state', listener);
  },
});

contextBridge.exposeInMainWorld('bubbleBridge', {
  getState: (): Promise<BubbleState> => ipcRenderer.invoke('bubble:get-state'),
  onState: (callback: (state: BubbleState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: BubbleState) => callback(state);
    ipcRenderer.on('bubble:state', listener);
    return () => ipcRenderer.removeListener('bubble:state', listener);
  },
});

contextBridge.exposeInMainWorld('appBridge', {
  getSnapshot: (): Promise<AppSnapshot> => ipcRenderer.invoke('app:get-snapshot'),
  updateSettings: (patch: AppSettingsPatch): Promise<AppSnapshot> => ipcRenderer.invoke('app:update-settings', patch),
  resetSettings: (): Promise<AppSnapshot> => ipcRenderer.invoke('app:reset-settings'),
  setPetVisible: (visible: boolean) => ipcRenderer.send('app:set-pet-visible', visible),
  setRoaming: (enabled: boolean) => ipcRenderer.send('app:set-roaming', enabled),
  openSettings: () => ipcRenderer.send('app:open-settings'),
  onSnapshot: (callback: (snapshot: AppSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) => callback(snapshot);
    ipcRenderer.on('app:snapshot-changed', listener);
    return () => ipcRenderer.removeListener('app:snapshot-changed', listener);
  },
});
