export type AnimationName = 'idle' | 'wave' | 'heart' | 'walk' | 'sit' | 'sleep_enter' | 'sleep_loop' | 'sleep_exit' | 'stand' | 'sleeping' | 'thinking' | 'happy';
export const isSleepAnimation = (mode: string) => mode === 'sleep_enter' || mode === 'sleep_loop' || mode === 'sleep_exit';
export type Facing = 'left' | 'right';

export type AnimationDefinition = {
  frames: string[];
  directionalFrames?: Partial<Record<Facing, string[]>>;
  framesPerSecond: number;
  /** Optional per-frame display time in milliseconds, indexed from frame 1. */
  frameDurationsMs?: number[];
  loop: boolean;
  durationMs?: number;
  fallback: AnimationName | 'static';
  fallbackMotion?: 'wave' | 'walk';
  holdLastFrame?: boolean;
  requireAllFrames?: boolean;
  reverseOf?: AnimationName;
  /** Uniform visual correction for transparent padding; offset is relative to display height. */
  presentation?: { scale: number; offsetYRatio: number };
};

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;
export const NO_FRAMES: string[] = [];
const idleFrames = [1, 2, 3, 4].map((frame) => asset(`animations/idle/idle_${String(frame).padStart(2, '0')}.png`));
const walkFrames: Record<Facing, string[]> = {
  left: [1, 2, 3].map((frame) => asset(`animations/walk/walk_left_${String(frame).padStart(2, '0')}.png`)),
  right: [1, 2, 3].map((frame) => asset(`animations/walk/walk_right_${String(frame).padStart(2, '0')}.png`)),
};
const heartFrames = Array.from({ length: 8 }, (_, index) =>
  asset(`animations/heart/heart_${String(index + 1).padStart(2, '0')}.png`),
);

// Solid-alpha bounds: idle y=19..1388 on 1408px, wave y=26..692 on 724px.
// Match visible height and feet without trimming or resampling either source.
const waveScale = ((1388 - 19) / 1408) / ((692 - 26) / 724);

const sleepFrames = (phase: 'enter' | 'loop' | 'exit') => [1, 2, 3, 4].map((frame) => {
  const name = `sleep_${phase}`;
  return asset(`animations/sleep/${name}/${name}_0${frame}.png`);
});

/** Add frame paths and timing here to register another animation clip. */
export const ANIMATIONS: Record<AnimationName, AnimationDefinition> = {
  idle: { frames: idleFrames, framesPerSecond: 3, loop: true, fallback: 'static' },
  wave: {
    frames: [1, 2, 3, 4, 5, 6].map((frame) => asset(`animations/wave/wave_${String(frame).padStart(2, '0')}.png`)),
    framesPerSecond: 4,
    loop: false,
    durationMs: 1_500,
    requireAllFrames: true,
    fallback: 'idle',
    presentation: { scale: waveScale, offsetYRatio: (1388 / 1408 - 1) - waveScale * (692 / 724 - 1) },
  },
  heart: {
    frames: heartFrames,
    framesPerSecond: 4,
    loop: false,
    durationMs: 2_000,
    fallback: 'idle',
  },
  walk: {
    frames: [],
    directionalFrames: walkFrames,
    framesPerSecond: 4,
    loop: true,
    fallback: 'idle',
    fallbackMotion: 'walk',
  },
  sit: {
    frames: [1, 2, 3, 4].map((frame) => asset(`animations/sit/sit_${String(frame).padStart(2, '0')}.png`)),
    framesPerSecond: 4,
    loop: false,
    holdLastFrame: true,
    requireAllFrames: true,
    fallback: 'idle',
  },
  sleep_enter: {
    frames: sleepFrames('enter'), framesPerSecond: 4, loop: false,
    durationMs: 1_000, requireAllFrames: true, fallback: 'static',
  },
  sleep_loop: {
    frames: sleepFrames('loop'), framesPerSecond: 2, loop: true,
    requireAllFrames: true, fallback: 'sleep_enter',
  },
  sleep_exit: {
    frames: sleepFrames('exit'), framesPerSecond: 4, loop: false,
    durationMs: 1_000, requireAllFrames: true, fallback: 'static',
  },
  stand: { frames: [], reverseOf: 'sit', framesPerSecond: 6, loop: false, durationMs: 670, fallback: 'idle' },
  sleeping: { frames: [], framesPerSecond: 2, loop: true, fallback: 'idle' },
  thinking: { frames: [], framesPerSecond: 4, loop: true, fallback: 'idle' },
  happy: { frames: [], framesPerSecond: 8, loop: false, durationMs: 700, fallback: 'idle' },
};

export const STATIC_PET_IMAGE = asset('pet.png');
export type LoadedAnimation = { frames: string[]; directionalFrames: Partial<Record<Facing, string[]>> };

function preloadSources(sources: string[]) {
  return Promise.all(sources.map((src) => new Promise<string | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(src);
    image.onerror = () => resolve(null);
    image.src = src;
  }))).then((frames) => frames.filter((frame): frame is string => frame !== null));
}

export async function preloadAnimationFrames() {
  const entries = await Promise.all(Object.entries(ANIMATIONS).map(async ([name, definition]) => {
    const [frames, left, right] = await Promise.all([
      preloadSources(definition.frames),
      preloadSources(definition.directionalFrames?.left ?? []),
      preloadSources(definition.directionalFrames?.right ?? []),
    ]);
    const completeFrames = definition.requireAllFrames && frames.length !== definition.frames.length ? [] : frames;
    return [name, { frames: completeFrames, directionalFrames: { left, right } }] as const;
  }));
  const loaded = Object.fromEntries(entries) as Partial<Record<AnimationName, LoadedAnimation>>;
  for (const [name, definition] of Object.entries(ANIMATIONS)) {
    if (definition.reverseOf) {
      loaded[name as AnimationName] = { frames: [...(loaded[definition.reverseOf]?.frames ?? [])].reverse(), directionalFrames: {} };
    }
  }
  return loaded;
}
