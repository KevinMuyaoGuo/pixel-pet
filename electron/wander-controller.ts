export type Facing = 'left' | 'right';
export type WanderMode = 'idle' | 'walk';

export const WANDER_CONFIG = {
  speedDipPerSecond: 30,
  verticalDriftFactor: 0.45,
  tickMs: 33,
  minRestMs: 5_000,
  maxRestMs: 12_000,
  minWalkMs: 3_000,
  maxWalkMs: 8_000,
  minRandomTurnMs: 1_600,
  maxRandomTurnMs: 4_200,
  turnPauseMs: 260,
  edgeRestProbability: 0.65,
} as const;

type Point = { x: number; y: number };
type WorkArea = { x: number; y: number; width: number; height: number };
type Display = { id: number; workArea: WorkArea };

export interface WanderWindow {
  isDestroyed(): boolean;
  getBounds(): { x: number; y: number; width: number; height: number };
  getPosition(): [number, number];
  setPosition(x: number, y: number): void;
}

export interface WanderScreen {
  getAllDisplays(): Display[];
  getDisplayNearestPoint(point: Point): Display;
}

type Callbacks = {
  getWindow: () => WanderWindow | null;
  isLocked: () => boolean;
  onModeChange: (mode: WanderMode | 'wave') => void;
  onFacingChange: (facing: Facing) => void;
  onEnabledChange: (enabled: boolean) => void;
  persistPosition: () => void;
};

type Phase = 'stopped' | 'rest' | 'walk' | 'turn';

/** Owns one timeout loop and moves the native Electron window in DIP coordinates. */
export class WanderController {
  private enabled = false;
  private paused = false;
  private manualDragActive = false;
  private interactionActive = false;
  private phase: Phase = 'stopped';
  private facing: Facing = 'right';
  private verticalDirection: -1 | 1 = 1;
  private movementRemainderX = 0;
  private movementRemainderY = 0;
  private displayId: number | null = null;
  private workArea: WorkArea | null = null;
  private minX = 0;
  private maxX = 0;
  private minY = 0;
  private maxY = 0;
  private phaseDeadline = 0;
  private randomTurnRemainingMs = 0;
  private pausedRemainingMs = 0;
  private manualDragRemainingMs = 0;
  private interactionRemainingMs = 0;
  private lastTick = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly screen: WanderScreen, private readonly callbacks: Callbacks) {}

  get isEnabled() { return this.enabled; }
  get mode(): WanderMode { return this.phase === 'walk' ? 'walk' : 'idle'; }
  get currentMode(): WanderMode | 'wave' { return this.interactionActive ? 'wave' : this.mode; }
  get direction() { return this.facing; }

  start() {
    if (this.enabled || this.callbacks.isLocked() || !this.getWindow()) return false;
    this.enabled = true;
    this.manualDragActive = false;
    this.interactionActive = false;
    this.setDisplayForCurrentWindow();
    this.recalculateBounds(true);
    this.phase = 'rest';
    this.lastTick = this.now();
    this.phaseDeadline = this.lastTick + this.randomDuration(WANDER_CONFIG.minRestMs, WANDER_CONFIG.maxRestMs);
    if (this.paused) this.pausedRemainingMs = this.phaseDeadline - this.lastTick;
    this.callbacks.onModeChange('idle');
    this.callbacks.onEnabledChange(true);
    this.scheduleTick();
    return true;
  }

  stop() {
    if (!this.enabled) return false;
    this.clearTick();
    this.enabled = false;
    this.manualDragActive = false;
    this.interactionActive = false;
    this.phase = 'stopped';
    this.callbacks.onModeChange('idle');
    this.callbacks.onEnabledChange(false);
    this.callbacks.persistPosition();
    return true;
  }

  setPaused(paused: boolean) {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!this.enabled) return;
    if (paused) {
      this.pausedRemainingMs = this.interactionActive
        ? this.interactionRemainingMs
        : this.manualDragActive
          ? this.manualDragRemainingMs
          : Math.max(0, this.phaseDeadline - this.now());
      this.clearTick();
      return;
    }
    if (this.interactionActive) return;
    if (this.manualDragActive) {
      this.manualDragRemainingMs = this.pausedRemainingMs;
      this.pausedRemainingMs = 0;
      return;
    }
    this.phaseDeadline = this.now() + this.pausedRemainingMs;
    this.lastTick = this.now();
    this.pausedRemainingMs = 0;
    this.scheduleTick();
  }

  beginWave() {
    if (this.enabled && !this.interactionActive) {
      this.interactionActive = true;
      this.interactionRemainingMs = Math.max(0, this.phaseDeadline - this.now());
      this.clearTick();
    }
    this.callbacks.onModeChange('wave');
  }

  finishWave() {
    if (!this.enabled || !this.interactionActive) {
      this.callbacks.onModeChange('idle');
      return;
    }
    this.interactionActive = false;
    this.phaseDeadline = this.now() + this.interactionRemainingMs;
    this.interactionRemainingMs = 0;
    this.lastTick = this.now();
    if (!this.manualDragActive) this.callbacks.onModeChange(this.mode);
    if (!this.paused && !this.manualDragActive) this.scheduleTick();
  }

  onManualDragStarted() {
    if (this.manualDragActive) return;
    if (this.enabled) {
      this.manualDragActive = true;
      if (!this.paused) {
        this.manualDragRemainingMs = this.interactionActive
          ? this.interactionRemainingMs
          : Math.max(0, this.phaseDeadline - this.now());
      }
      this.clearTick();
    }
    this.callbacks.onModeChange('idle');
  }

  onManualDragEnded() {
    this.setDisplayForCurrentWindow();
    this.recalculateBounds(false);
    this.callbacks.persistPosition();
    if (!this.manualDragActive) return;
    this.manualDragActive = false;
    if (!this.enabled || this.paused || this.interactionActive) return;
    this.phaseDeadline = this.now() + this.manualDragRemainingMs;
    this.manualDragRemainingMs = 0;
    this.lastTick = this.now();
    this.callbacks.onModeChange(this.mode);
    this.scheduleTick();
  }

  onDisplayConfigurationChanged() {
    const window = this.getWindow();
    if (!window) return;
    const displays = this.screen.getAllDisplays();
    if (!displays.length) return;
    if (!this.enabled || this.displayId === null || !displays.some((display) => display.id === this.displayId)) {
      this.setDisplayForCurrentWindow();
    }
    this.recalculateBounds(true);
  }

  dispose() {
    this.clearTick();
    this.enabled = false;
    this.manualDragActive = false;
    this.phase = 'stopped';
  }

  private getWindow() {
    const window = this.callbacks.getWindow();
    return window && !window.isDestroyed() ? window : null;
  }

  private now() { return performance.now(); }

  private randomDuration(min: number, max: number) {
    return Math.round(min + Math.random() * (max - min));
  }

  private setDisplayForCurrentWindow() {
    const window = this.getWindow();
    if (!window) return;
    const bounds = window.getBounds();
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const display = this.screen.getDisplayNearestPoint(center);
    this.displayId = display.id;
    this.workArea = display.workArea;
  }

  private recalculateBounds(preserveDisplay: boolean) {
    const window = this.getWindow();
    if (!window) return;
    const displays = this.screen.getAllDisplays();
    const selected = preserveDisplay && this.displayId !== null
      ? displays.find((display) => display.id === this.displayId)
      : undefined;
    const current = selected ?? this.screen.getDisplayNearestPoint({
      x: window.getBounds().x + window.getBounds().width / 2,
      y: window.getBounds().y + window.getBounds().height / 2,
    });
    this.displayId = current.id;
    this.workArea = current.workArea;
    const bounds = window.getBounds();
    this.minX = current.workArea.x;
    this.maxX = current.workArea.x + Math.max(0, current.workArea.width - bounds.width);
    this.minY = current.workArea.y;
    this.maxY = current.workArea.y + Math.max(0, current.workArea.height - bounds.height);

    const [oldX, oldY] = window.getPosition();
    const x = this.clamp(oldX, this.minX, this.maxX);
    const y = this.clamp(oldY, this.minY, this.maxY);
    this.movementRemainderX = 0;
    this.movementRemainderY = 0;
    this.setWindowPosition(x, y);
    if (x <= this.minX) this.setFacing('right');
    else if (x >= this.maxX) this.setFacing('left');
  }

  private scheduleTick() {
    if (!this.enabled || this.paused || this.manualDragActive || this.interactionActive || this.timer) return;
    this.lastTick = this.now();
    const remaining = Math.max(1, this.phaseDeadline - this.lastTick);
    const delay = this.phase === 'walk' ? WANDER_CONFIG.tickMs : remaining;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.tick();
    }, delay);
  }

  private clearTick() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private tick() {
    if (!this.enabled || this.paused || this.manualDragActive || this.interactionActive || this.callbacks.isLocked()) return;
    const now = this.now();
    const previousTick = this.lastTick;
    const elapsedMs = Math.max(0, now - previousTick);
    this.lastTick = now;

    if (this.phase === 'rest' && now >= this.phaseDeadline) {
      this.startWalk(now);
    } else if (this.phase === 'turn' && now >= this.phaseDeadline) {
      if (Math.random() < WANDER_CONFIG.edgeRestProbability) this.startRest(now);
      else this.startWalk(now);
    } else if (this.phase === 'walk') {
      const activeMs = Math.max(0, Math.min(elapsedMs, this.phaseDeadline - previousTick));
      this.moveWindow(activeMs / 1000);
      if (this.phase === 'walk') {
        this.randomTurnRemainingMs -= activeMs;
        if (this.randomTurnRemainingMs <= 0) {
          this.setFacing(this.facing === 'right' ? 'left' : 'right');
          this.verticalDirection = Math.random() < 0.5 ? -1 : 1;
          this.randomTurnRemainingMs = this.randomDuration(WANDER_CONFIG.minRandomTurnMs, WANDER_CONFIG.maxRandomTurnMs);
        }
        if (now >= this.phaseDeadline) this.startRest(now);
      }
    }
    this.scheduleTick();
  }

  private startRest(now: number) {
    this.phase = 'rest';
    this.phaseDeadline = now + this.randomDuration(WANDER_CONFIG.minRestMs, WANDER_CONFIG.maxRestMs);
    this.callbacks.onModeChange('idle');
  }

  private startWalk(now: number) {
    if (this.callbacks.isLocked()) { this.stop(); return; }
    if (!this.workArea) this.recalculateBounds(false);
    const [x] = this.getWindow()?.getPosition() ?? [this.minX, this.minY];
    if (x <= this.minX) this.setFacing('right');
    else if (x >= this.maxX) this.setFacing('left');
    this.phase = 'walk';
    this.phaseDeadline = now + this.randomDuration(WANDER_CONFIG.minWalkMs, WANDER_CONFIG.maxWalkMs);
    this.verticalDirection = Math.random() < 0.5 ? -1 : 1;
    this.randomTurnRemainingMs = this.randomDuration(WANDER_CONFIG.minRandomTurnMs, WANDER_CONFIG.maxRandomTurnMs);
    this.callbacks.onModeChange('walk');
  }

  private moveWindow(seconds: number) {
    const window = this.getWindow();
    if (!window || !this.workArea || seconds <= 0) return;
    const [x, y] = window.getPosition();
    const horizontalDirection = this.facing === 'right' ? 1 : -1;
    const verticalSpeedFactor = this.verticalDirection * WANDER_CONFIG.verticalDriftFactor;
    const speedScale = WANDER_CONFIG.speedDipPerSecond / Math.hypot(1, WANDER_CONFIG.verticalDriftFactor);
    const exactX = x + this.movementRemainderX + horizontalDirection * speedScale * seconds;
    const exactY = y + this.movementRemainderY + verticalSpeedFactor * speedScale * seconds;
    const nextX = this.clamp(exactX, this.minX, this.maxX);
    const nextY = this.clamp(exactY, this.minY, this.maxY);
    this.movementRemainderX = nextX === exactX ? exactX - Math.round(exactX) : 0;
    this.movementRemainderY = nextY === exactY ? exactY - Math.round(exactY) : 0;
    const reachedHorizontalEdge = this.facing === 'right' ? nextX >= this.maxX : nextX <= this.minX;
    const reachedVerticalEdge = this.verticalDirection < 0 ? nextY <= this.minY : nextY >= this.maxY;
    this.setWindowPosition(nextX, nextY);
    if (reachedVerticalEdge && this.minY < this.maxY) {
      this.verticalDirection = this.verticalDirection === 1 ? -1 : 1;
    }
    if (reachedHorizontalEdge) {
      this.setFacing(this.facing === 'right' ? 'left' : 'right');
      this.phase = 'turn';
      this.phaseDeadline = this.now() + WANDER_CONFIG.turnPauseMs;
      this.callbacks.onModeChange('idle');
    }
  }

  private setFacing(facing: Facing) {
    if (this.facing === facing) return;
    this.facing = facing;
    this.callbacks.onFacingChange(facing);
  }

  private setWindowPosition(x: number, y: number) {
    const window = this.getWindow();
    if (!window) return;
    const [currentX, currentY] = window.getPosition();
    const nextX = Math.round(x);
    const nextY = Math.round(y);
    if (nextX !== currentX || nextY !== currentY) window.setPosition(nextX, nextY);
  }

  private clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
  }
}
