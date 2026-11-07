import React from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_APP_SETTINGS } from '../electron/settings-types';
import { animationStateFor, type PetUiState, type PetAnimationState } from '../electron/pet-state';
import { ANIMATIONS, NO_FRAMES, preloadAnimationFrames, STATIC_PET_IMAGE, type AnimationName, type Facing, type LoadedAnimation } from './animation-system';
import './style.css';

const DISPLAY_HEIGHT = 180;
type PetMode = AnimationName | 'dragging' | 'paused';
type PetState = { mode: PetMode; beforePause: PetMode; hovered: boolean; locked: boolean; roaming: boolean; facing: Facing; actionId: number | null; animationState: PetAnimationState; standFromFrame: number };
type PetAction =
  | { type: 'sync-ui'; uiState: PetUiState }
  | { type: 'set-hovered'; hovered: boolean }
  | { type: 'set-locked'; locked: boolean };

const initialState: PetState = { mode: 'idle', beforePause: 'idle', hovered: false, locked: false, roaming: false, facing: 'right', actionId: null, animationState: 'IDLE', standFromFrame: 3 };

function petReducer(state: PetState, action: PetAction): PetState {
  switch (action.type) {
    case 'sync-ui': {
      const mode = action.uiState.mode === 'dragging' ? 'dragging' : action.uiState.paused ? 'paused' : action.uiState.mode;
      return {
        ...state,
        mode,
        beforePause: action.uiState.mode === 'dragging' ? 'idle' : action.uiState.mode,
        locked: action.uiState.locked,
        roaming: action.uiState.roaming,
        facing: action.uiState.direction,
        actionId: action.uiState.actionId,
        standFromFrame: action.uiState.standFromFrame ?? 3,
        animationState: animationStateFor(action.uiState),
      };
    }
    case 'set-hovered': return { ...state, hovered: action.hovered };
    case 'set-locked': return { ...state, locked: action.locked };
  }
}

function useAnimationFrame(mode: AnimationName, facing: Facing, paused: boolean, playbackRate: number, actionId: number | null, initialFrame: number, framesByAnimation: Partial<Record<AnimationName, LoadedAnimation>>, onComplete: () => void) {
  const key = `${mode}:${actionId ?? ''}`;
  const [cursor, setCursor] = React.useState({ key, index: initialFrame });
  const frameIndex = cursor.key === key ? cursor.index : initialFrame;
  const playback = React.useRef<{ frame: number; remainingMs: number | null }>({ frame: 0, remainingMs: null });
  const clip = framesByAnimation[mode];
  const directionalFrames = clip?.directionalFrames[facing] ?? NO_FRAMES;
  const hasDirectionalFrames = directionalFrames.length > 0;
  const frames = hasDirectionalFrames ? directionalFrames : clip?.frames ?? NO_FRAMES;

  React.useEffect(() => {
    playback.current = { frame: initialFrame, remainingMs: null };
    setCursor({ key, index: initialFrame });
  }, [key, initialFrame]);
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
            setCursor({ key, index: frames.length - 1 });
            if (!definition.holdLastFrame) onComplete();
            return;
          }
          timing.frame = next % frames.length;
          setCursor({ key, index: timing.frame });
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
  }, [mode, paused, playbackRate, key, initialFrame, frames, onComplete]);

  return { frameIndex, frames, hasDirectionalFrames };
}

function Pet() {
  const [state, dispatch] = React.useReducer(petReducer, initialState);
  const [framesByAnimation, setFramesByAnimation] = React.useState<Partial<Record<AnimationName, LoadedAnimation>>>({});
  const [framePreloadComplete, setFramePreloadComplete] = React.useState(false);
  const [petScalePercent, setPetScalePercent] = React.useState(100);
  const [roamingSpeed, setRoamingSpeed] = React.useState(DEFAULT_APP_SETTINGS.roamingSpeedDipPerSecond);
  const pointerStart = React.useRef<{ id: number; x: number; y: number; dragging: boolean } | null>(null);
  const hoverRequested = React.useRef(false);
  React.useEffect(() => { hoverRequested.current = false; }, [state.mode]);

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
        setPetScalePercent(snapshot.settings.petScalePercent);
        setRoamingSpeed(snapshot.settings.roamingSpeedDipPerSecond);
      }
    });
    const unsubscribe = window.appBridge.onSnapshot((snapshot) => {
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
    if (state.actionId !== null) window.petBridge.finishAction(state.actionId);
  }, [state.actionId]);
  const currentAnimation: AnimationName = state.mode === 'paused'
    ? (state.beforePause === 'dragging' || state.beforePause === 'paused' ? 'idle' : state.beforePause)
    : state.mode === 'dragging' ? 'idle' : state.mode;
  const animationPaused = state.mode === 'paused' || state.mode === 'dragging';
  // Keep the default 4 fps gait; ease the increase above normal movement speed.
  const movementSpeedRatio = roamingSpeed / DEFAULT_APP_SETTINGS.roamingSpeedDipPerSecond;
  const walkPlaybackRate = movementSpeedRatio > 1 ? Math.sqrt(movementSpeedRatio) : movementSpeedRatio;
  const playbackRate = currentAnimation === 'walk' ? walkPlaybackRate : 1;
  const initialFrame = currentAnimation === 'stand' ? 3 - state.standFromFrame : 0;
  const { frameIndex, frames, hasDirectionalFrames } = useAnimationFrame(currentAnimation, state.facing, animationPaused, playbackRate, state.actionId, initialFrame, framesByAnimation, handleAnimationComplete);
  const idleClip = framesByAnimation.idle;
  const idleDirectionalFrames = idleClip?.directionalFrames[state.facing] ?? NO_FRAMES;
  const idleFrames = idleDirectionalFrames.length ? idleDirectionalFrames : idleClip?.frames ?? NO_FRAMES;
  const availableFrames = frames.length > 1 ? frames : currentAnimation === 'idle' || currentAnimation === 'sit' ? frames : [];
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
        : state.mode === 'sit' ? hasAnimationFrames ? '坐下休息' : '休息中，坐姿素材缺失，静止站立回退'
        : state.mode === 'stand' ? '正在站起'
        : state.mode === 'walk' ? '行走中'
          : state.mode === 'idle' ? '待机' : state.mode;

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    pointerStart.current = { id: event.pointerId, x: event.screenX, y: event.screenY, dragging: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCharacterHover = (event: React.PointerEvent<HTMLImageElement>) => {
    if (event.pointerType !== 'mouse' || state.mode !== 'sit' || pointerStart.current || hoverRequested.current) return;
    hoverRequested.current = true;
    window.petBridge.hover(frames.length === 4 ? frameIndex : null);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const start = pointerStart.current;
    if (!start || start.id !== event.pointerId || state.locked) return;
    if (!start.dragging && Math.hypot(event.screenX - start.x, event.screenY - start.y) >= 4) {
      start.dragging = true;
      window.petBridge.beginDrag({ screenX: start.x, screenY: start.y });
    }
    if (start.dragging) window.petBridge.dragTo({ screenX: event.screenX, screenY: event.screenY });
  };

  const finishPointer = (event: React.PointerEvent<HTMLElement>, cancelled = false) => {
    const start = pointerStart.current;
    if (!start || start.id !== event.pointerId) return;
    pointerStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (start.dragging) {
      window.petBridge.endDrag();
    } else if (!cancelled && state.mode !== 'paused') {
      window.petBridge.click();
    }
  };

  return <main
    className="pet-window"
    aria-label={`桌面宠物，${statusText}${state.roaming ? '，自主漫步已开启' : ''}${state.hovered ? '，鼠标悬停' : ''}${state.locked ? '，位置已锁定' : ''}`}
    data-mode={state.mode}
    data-animation-state={state.animationState}
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
    onPointerUp={(event) => finishPointer(event)}
    onPointerCancel={(event) => finishPointer(event, true)}
    onLostPointerCapture={(event) => finishPointer(event, true)}
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
        onPointerEnter={handleCharacterHover}
        onPointerMove={handleCharacterHover}
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
