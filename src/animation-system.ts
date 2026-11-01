export type AnimationName = 'idle' | 'wave' | 'walk' | 'sleeping' | 'thinking' | 'happy';
export type Facing = 'left' | 'right';

export type AnimationDefinition = {
  frames: string[];
  directionalFrames?: Partial<Record<Facing, string[]>>;
  framesPerSecond: number;
  loop: boolean;
  durationMs?: number;
  fallback: AnimationName | 'static';
  fallbackMotion?: 'wave' | 'walk';
};

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;
export const NO_FRAMES: string[] = [];
const idleFrames = [1, 2, 3, 4].map((frame) => asset(`animations/idle/idle_${String(frame).padStart(2, '0')}.png`));
const walkFrames: Record<Facing, string[]> = {
  left: [1, 2, 3].map((frame) => asset(`animations/walk/walk_left_${String(frame).padStart(2, '0')}.png`)),
  right: [1, 2, 3].map((frame) => asset(`animations/walk/walk_right_${String(frame).padStart(2, '0')}.png`)),
};

/** Add frame paths and timing here to register another animation clip. */
export const ANIMATIONS: Record<AnimationName, AnimationDefinition> = {
  idle: { frames: idleFrames, framesPerSecond: 3, loop: true, fallback: 'static' },
  wave: { frames: [], framesPerSecond: 8, loop: false, durationMs: 680, fallback: 'idle', fallbackMotion: 'wave' },
  walk: {
    frames: [],
    directionalFrames: walkFrames,
    framesPerSecond: 4,
    loop: true,
    fallback: 'idle',
    fallbackMotion: 'walk',
  },
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
    return [name, { frames, directionalFrames: { left, right } }] as const;
  }));
  return Object.fromEntries(entries) as Partial<Record<AnimationName, LoadedAnimation>>;
}
