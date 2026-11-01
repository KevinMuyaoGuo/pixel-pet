export {};

declare global {
  interface Window {
    petBridge: {
      getUiState: () => Promise<{
        paused: boolean;
        locked: boolean;
        roaming: boolean;
        mode: 'idle' | 'walk' | 'wave' | 'dragging';
        direction: 'left' | 'right';
      }>;
      setRoaming: (enabled: boolean) => void;
      beginWave: () => void;
      finishWave: () => void;
      beginDrag: (point: { screenX: number; screenY: number }) => void;
      dragTo: (point: { screenX: number; screenY: number }) => void;
      endDrag: () => void;
      showContextMenu: () => void;
      onUiState: (callback: (state: {
        paused: boolean;
        locked: boolean;
        roaming: boolean;
        mode: 'idle' | 'walk' | 'wave' | 'dragging';
        direction: 'left' | 'right';
      }) => void) => () => void;
    };
  }
}
