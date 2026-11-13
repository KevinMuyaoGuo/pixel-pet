export type PetMode = 'idle' | 'walk' | 'wave' | 'heart' | 'sit' | 'sleep_enter' | 'sleep_loop' | 'sleep_exit' | 'stand' | 'dragging';
export type PetAnimationState = 'IDLE' | 'WALK_LEFT' | 'WALK_RIGHT' | 'WAVE' | 'HEART' | 'SIT' | 'SLEEP_ENTER' | 'SLEEP_LOOP' | 'SLEEP_EXIT' | 'STAND' | 'DRAGGING' | 'PAUSED';

export type PetUiState = {
  paused: boolean;
  locked: boolean;
  roaming: boolean;
  mode: PetMode;
  direction: 'left' | 'right';
  actionId: number | null;
  standFromFrame: number;
};

export type BubblePlacement = 'above' | 'below';
export type BubbleState = { message: string | null; placement: BubblePlacement };

export function animationStateFor(state: PetUiState): PetAnimationState {
  if (state.mode === 'dragging') return 'DRAGGING';
  if (state.paused) return 'PAUSED';
  if (state.mode === 'walk') return state.direction === 'left' ? 'WALK_LEFT' : 'WALK_RIGHT';
  return state.mode.toUpperCase() as PetAnimationState;
}
