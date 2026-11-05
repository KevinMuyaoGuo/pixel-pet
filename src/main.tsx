import React from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_APP_SETTINGS } from '../electron/settings-types';
import { ANIMATIONS, NO_FRAMES, preloadAnimationFrames, STATIC_PET_IMAGE, type AnimationName, type Facing, type LoadedAnimation } from './animation-system';
import './style.css';

const DISPLAY_HEIGHT = 180;
type PetMode = AnimationName | 'dragging' | 'paused';
type PetState = { mode: PetMode; beforePause: PetMode; hovered: boolean; locked: boolean; roaming: boolean; facing: Facing };
type PetAction =
  | { type: 'set-mode'; mode: PetMode }
  | { type: 'sync-ui'; uiState: { paused: boolean; locked: boolean; roaming: boolean; mode: PetMode; direction: Facing } }
  | { type: 'set-hovered'; hovered: boolean }
  | { type: 'set-locked'; locked: boolean };

const initialState: PetState = { mode: 'idle', beforePause: 'idle', hovered: false, locked: false, roaming: false, facing: 'right' };

function petReducer(state: PetState, action: PetAction): PetState {
  switch (action.type) {
    case 'set-mode':
      return state.mode === 'paused'
        ? { ...state, beforePause: action.mode }
        : { ...state, mode: action.mode, beforePause: action.mode };
    case 'sync-ui': {
      const mode = action.uiState.paused ? 'paused' : action.uiState.mode;
      return {
        ...state,
        mode,
        beforePause: action.uiState.mode === 'dragging' ? 'idle' : action.uiState.mode,
        locked: action.uiState.locked,
        roaming: action.uiState.roaming,
        facing: action.uiState.direction,
      };
    }
    case 'set-hovered': return { ...state, hovered: action.hovered };
    case 'set-locked': return { ...state, locked: action.locked };
  }
}

function useAnimationFrame(mode: AnimationName, facing: Facing, paused: boolean, playbackRate: number, framesByAnimation: Partial<Record<AnimationName, LoadedAnimation>>, onComplete: () => void) {
  const [frameIndex, setFrameIndex] = React.useState(0);
  const playback = React.useRef<{ frame: number; remainingMs: number | null }>({ frame: 0, remainingMs: null });
  const clip = framesByAnimation[mode];
  const directionalFrames = clip?.directionalFrames[facing] ?? NO_FRAMES;
  const hasDirectionalFrames = directionalFrames.length > 0;
  const frames = hasDirectionalFrames ? directionalFrames : clip?.frames ?? NO_FRAMES;

  React.useEffect(() => {
    playback.current = { frame: 0, remainingMs: null };
    setFrameIndex(0);
  }, [mode]);
  React.useEffect(() => {
    if (paused) return;
    const definition = ANIMATIONS[mode];
    const timing = playback.current;

    if (frames.length > 1) {
      let timer = 0;
      let scheduledAt = 0;
      let remainingMs = 0;
      const scheduleNextFrame = () => {
        timing.frame %= frames.length;
        remainingMs = timing.remainingMs ?? definition.frameDurationsMs?.[timing.frame] ?? 1000 / Math.max(1, definition.framesPerSecond);
        scheduledAt = performance.now();
        timer = window.setTimeout(() => {
          timer = 0;
          timing.remainingMs = null;
          const next = timing.frame + 1;
          if (next >= frames.length && !definition.loop) {
            setFrameIndex(frames.length - 1);
            onComplete();
            return;
          }
          timing.frame = next % frames.length;
          setFrameIndex(timing.frame);
          scheduleNextFrame();
        }, remainingMs / playbackRate);
      };
      scheduleNextFrame();
      return () => {
        if (!timer) return;
        window.clearTimeout(timer);
        // Store clip time, so pause, direction and speed changes preserve frame progress.
        timing.remainingMs = Math.max(0, remainingMs - (performance.now() - scheduledAt) * playbackRate);
      };
    }

    if (!definition.loop && definition.durationMs && definition.fallbackMotion !== 'wave') {
      const timer = window.setTimeout(onComplete, definition.durationMs);
      return () => window.clearTimeout(timer);
    }
  }, [mode, paused, playbackRate, frames, onComplete]);

  return { frameIndex, frames, hasDirectionalFrames };
}

function Pet() {
  const [state, dispatch] = React.useReducer(petReducer, initialState);
  const [framesByAnimation, setFramesByAnimation] = React.useState<Partial<Record<AnimationName, LoadedAnimation>>>({});
  const [framePreloadComplete, setFramePreloadComplete] = React.useState(false);
  const [allowClickHeart, setAllowClickHeart] = React.useState(true);
  const [petScalePercent, setPetScalePercent] = React.useState(100);
  const [roamingSpeed, setRoamingSpeed] = React.useState(DEFAULT_APP_SETTINGS.roamingSpeedDipPerSecond);
  const pointerStart = React.useRef<{ id: number; x: number; y: number; dragging: boolean } | null>(null);

  React.useEffect(() => {
    let active = true;
    void preloadAnimationFrames().then((frames) => {
      if (!active) return;
      setFramesByAnimation(frames);
      setFramePreloadComplete(true);
    });
    return () => { active = false; };
  }, []);

  React.useEffect(() => {
    let active = true;
    void window.appBridge.getSnapshot().then((snapshot) => {
      if (active) {
        setAllowClickHeart(snapshot.settings.allowClickHeart);
        setPetScalePercent(snapshot.settings.petScalePercent);
        setRoamingSpeed(snapshot.settings.roamingSpeedDipPerSecond);
      }
    });
    const unsubscribe = window.appBridge.onSnapshot((snapshot) => {
      setAllowClickHeart(snapshot.settings.allowClickHeart);
      setPetScalePercent(snapshot.settings.petScalePercent);
      setRoamingSpeed(snapshot.settings.roamingSpeedDipPerSecond);
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  React.useEffect(() => {
    let active = true;
    void window.petBridge.getUiState().then((uiState) => {
      if (!active) return;
      dispatch({ type: 'sync-ui', uiState });
    });
    const unsubscribe = window.petBridge.onUiState((uiState) => {
      dispatch({ type: 'sync-ui', uiState });
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  const handleAnimationComplete = React.useCallback(() => {
    dispatch({ type: 'set-mode', mode: 'idle' });
    window.petBridge.finishAction();
  }, []);
  const currentAnimation: AnimationName = state.mode === 'paused'
    ? (state.beforePause === 'dragging' || state.beforePause === 'paused' ? 'idle' : state.beforePause)
    : state.mode === 'dragging' ? 'idle' : state.mode;
  const animationPaused = state.mode === 'paused' || state.mode === 'dragging';
  // Keep the default 4 fps gait; ease the increase above normal movement speed.
  const movementSpeedRatio = roamingSpeed / DEFAULT_APP_SETTINGS.roamingSpeedDipPerSecond;
  const walkPlaybackRate = movementSpeedRatio > 1 ? Math.sqrt(movementSpeedRatio) : movementSpeedRatio;
  const playbackRate = currentAnimation === 'walk' ? walkPlaybackRate : 1;
  const { frameIndex, frames, hasDirectionalFrames } = useAnimationFrame(currentAnimation, state.facing, animationPaused, playbackRate, framesByAnimation, handleAnimationComplete);
  const idleClip = framesByAnimation.idle;
  const idleDirectionalFrames = idleClip?.directionalFrames[state.facing] ?? NO_FRAMES;
  const idleFrames = idleDirectionalFrames.length ? idleDirectionalFrames : idleClip?.frames ?? NO_FRAMES;
  const availableFrames = frames.length > 1 ? frames : currentAnimation === 'idle' ? frames : [];
  const fallbackName = ANIMATIONS[currentAnimation].fallback;
  const fallbackClip = fallbackName === 'static' ? undefined : framesByAnimation[fallbackName];
  const fallbackDirectionalFrames = fallbackClip?.directionalFrames[state.facing] ?? NO_FRAMES;
  const fallbackFrames = fallbackName === 'static' ? NO_FRAMES : fallbackDirectionalFrames.length ? fallbackDirectionalFrames : fallbackClip?.frames ?? NO_FRAMES;
  const resolvedCharacterImage = state.mode === 'dragging'
    ? idleFrames[0] ?? STATIC_PET_IMAGE
    : availableFrames.length
      ? availableFrames[frameIndex % availableFrames.length]
      : fallbackFrames[0] ?? STATIC_PET_IMAGE;
  const characterImage = framePreloadComplete
    ? resolvedCharacterImage
    : ANIMATIONS.idle.frames[0] ?? STATIC_PET_IMAGE;
  const hasAnimationFrames = availableFrames.length > 1;
  const usesDirectionalFrames = hasDirectionalFrames || (availableFrames.length === 0 && fallbackDirectionalFrames.length > 0);
  const visualMode = state.mode === 'paused' ? state.beforePause : state.mode;
  const statusText = state.mode === 'paused' ? '动画已暂停'
    : state.mode === 'dragging' ? '正在拖动'
      : state.mode === 'wave' ? '挥手中'
        : state.mode === 'heart' ? '比心中'
        : state.mode === 'walk' ? '行走中'
          : state.mode === 'idle' ? '待机' : state.mode;

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || state.locked) return;
    pointerStart.current = { id: event.pointerId, x: event.screenX, y: event.screenY, dragging: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const start = pointerStart.current;
    if (!start || start.id !== event.pointerId || state.locked) return;
    if (!start.dragging && Math.hypot(event.screenX - start.x, event.screenY - start.y) >= 4) {
      start.dragging = true;
      window.petBridge.beginDrag({ screenX: start.x, screenY: start.y });
      dispatch({ type: 'set-mode', mode: 'dragging' });
    }
    if (start.dragging) window.petBridge.dragTo({ screenX: event.screenX, screenY: event.screenY });
  };

  const finishPointer = (event: React.PointerEvent<HTMLElement>) => {
    const start = pointerStart.current;
    if (!start || start.id !== event.pointerId) return;
    pointerStart.current = null;
    if (start.dragging) {
      window.petBridge.endDrag();
      dispatch({ type: 'set-mode', mode: 'idle' });
    } else if (!state.locked && state.mode !== 'paused' && allowClickHeart) {
      window.petBridge.startAction('heart');
      dispatch({ type: 'set-mode', mode: 'heart' });
    }
  };

  return <main
    className="pet-window"
    aria-label={`桌面宠物，${statusText}${state.roaming ? '，自主漫步已开启' : ''}${state.hovered ? '，鼠标悬停' : ''}${state.locked ? '，位置已锁定' : ''}`}
    data-mode={state.mode}
    data-visual-mode={visualMode}
    data-hovered={state.hovered}
    data-locked={state.locked}
    data-has-frames={hasAnimationFrames}
    data-idle-frames={idleFrames.length > 1 || !framePreloadComplete}
    data-facing={state.facing}
    data-directional-frames={usesDirectionalFrames}
    style={{ '--walk-animation-duration': `${520 / walkPlaybackRate}ms` } as React.CSSProperties}
    onPointerDown={handlePointerDown}
    onPointerMove={handlePointerMove}
    onPointerUp={finishPointer}
    onPointerCancel={finishPointer}
    onPointerEnter={() => dispatch({ type: 'set-hovered', hovered: true })}
    onPointerLeave={() => dispatch({ type: 'set-hovered', hovered: false })}
    onContextMenu={(event) => { event.preventDefault(); window.petBridge.showContextMenu(); }}
  >
    <div className="pet-stage">
      <img
        className="pet-art"
        src={characterImage}
        alt="Q版桌宠"
        style={{ height: DISPLAY_HEIGHT * petScalePercent / 100, '--direction-scale': state.facing === 'left' && !usesDirectionalFrames && currentAnimation !== 'heart' ? -1 : 1 } as React.CSSProperties}
        draggable={false}
        onAnimationEnd={(event) => {
          if (event.animationName === 'wave-gesture' && state.mode === 'wave') handleAnimationComplete();
        }}
      />
    </div>
  </main>;
}

const root = createRoot(document.getElementById('root')!);
root.render(<React.StrictMode><Pet /></React.StrictMode>);

if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
