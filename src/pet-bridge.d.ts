import type { AppSettingsPatch, AppSnapshot } from '../electron/settings-types.js';

export {};

declare global {
  interface Window {
    petBridge: {
      getUiState: () => Promise<{
        paused: boolean;
        locked: boolean;
        roaming: boolean;
        mode: 'idle' | 'walk' | 'wave' | 'heart' | 'dragging';
        direction: 'left' | 'right';
      }>;
      setRoaming: (enabled: boolean) => void;
      startAction: (mode: 'wave' | 'heart') => void;
      finishAction: () => void;
      beginDrag: (point: { screenX: number; screenY: number }) => void;
      dragTo: (point: { screenX: number; screenY: number }) => void;
      endDrag: () => void;
      showContextMenu: () => void;
      onUiState: (callback: (state: {
        paused: boolean;
        locked: boolean;
        roaming: boolean;
        mode: 'idle' | 'walk' | 'wave' | 'heart' | 'dragging';
        direction: 'left' | 'right';
      }) => void) => () => void;
    };
    appBridge: {
      getSnapshot: () => Promise<AppSnapshot>;
      updateSettings: (patch: AppSettingsPatch) => Promise<AppSnapshot>;
      resetSettings: () => Promise<AppSnapshot>;
      setPetVisible: (visible: boolean) => void;
      setRoaming: (enabled: boolean) => void;
      openSettings: () => void;
      onSnapshot: (callback: (snapshot: AppSnapshot) => void) => () => void;
    };
  }
}
