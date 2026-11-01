import { contextBridge, ipcRenderer } from 'electron';

type UiState = {
  paused: boolean;
  locked: boolean;
  roaming: boolean;
  mode: 'idle' | 'walk' | 'wave' | 'dragging';
  direction: 'left' | 'right';
};
type ScreenPoint = { screenX: number; screenY: number };

contextBridge.exposeInMainWorld('petBridge', {
  getUiState: (): Promise<UiState> => ipcRenderer.invoke('pet:get-ui-state'),
  setRoaming: (enabled: boolean) => ipcRenderer.send('pet:set-roaming', enabled),
  beginWave: () => ipcRenderer.send('pet:wave-start'),
  finishWave: () => ipcRenderer.send('pet:wave-finish'),
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
