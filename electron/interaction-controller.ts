import { DEFAULT_APP_SETTINGS, type AppSettings } from './settings-types.js';
import { SYSTEM_CLOCK, type ControllerClock } from './controller-clock.js';

export const INTERACTION_CONFIG = {
  sitTransitionMs: 1_000,
  waveIntervalsMs: [50_000, 35_000, 20_000],
  bubbleDurationMs: 2_600,
  responses: [
    { message: '你好呀！', action: 'wave' },
    { message: '在干嘛？', action: null },
    { message: '休息一下吧~', action: null },
    { message: '今天也要想我哦~', action: null },
    { message: '爱你哦~', action: 'heart' },
  ],
} as const;

type BehaviorSettings = Pick<AppSettings, 'autoSleep' | 'sleepTimeoutSeconds' | 'randomWave' | 'behaviorFrequency'>;
type Options = BehaviorSettings & { autoSit: boolean; idleSeconds: number; bubbles: boolean };
const { autoSleep, sleepTimeoutSeconds, randomWave, behaviorFrequency } = DEFAULT_APP_SETTINGS;
const behaviorDefaults = { autoSleep, sleepTimeoutSeconds, randomWave, behaviorFrequency };

/** Owns one deadline timer for inactivity and one replaceable text bubble. */
export class InteractionController {
  private options: Options = { autoSit: true, idleSeconds: 60, bubbles: true, ...behaviorDefaults };
  private blocked = true;
  private restMode: 'sit' | 'sleep_enter' | 'sleep_loop' | null = null;
  private seatedAt = 0;
  private waveAt = 0;
  private blockedAt = 0;
  private lastActivity: number;
  private bubbleDeadline: number | null = null;
  private message: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly onChange: () => void, private readonly clock: ControllerClock = SYSTEM_CLOCK, private readonly random: () => number = () => Math.random(), private readonly onRandomWave?: () => void) {
    this.lastActivity = clock.now();
    this.resetWaveDeadline(this.lastActivity);
  }

  get isSitting() { return this.restMode !== null; }
  get isSleeping() { return this.restMode === 'sleep_enter' || this.restMode === 'sleep_loop'; }
  get restingMode() { return this.restMode; }
  get bubble() { return { message: this.message }; }

  configure(options: Pick<Options, 'autoSit' | 'idleSeconds' | 'bubbles'> & Partial<BehaviorSettings>) {
    const previous = this.options;
    this.options = { ...behaviorDefaults, ...options };
    if (previous.randomWave !== this.options.randomWave || previous.behaviorFrequency !== this.options.behaviorFrequency) {
      this.resetWaveDeadline(this.clock.now());
    }
    if ((!options.autoSit && this.restMode === 'sit') || (!this.options.autoSleep && this.isSleeping)) this.restMode = null;
    if (!options.bubbles) this.clearBubble();
    this.onChange();
    this.schedule();
  }

  setBlocked(blocked: boolean, preserveIdle = false) {
    if (this.blocked === blocked || this.disposed) return;
    this.blocked = blocked;
    // Pauses and one-shot actions should never cause an overdue sit on resume.
    const now = this.clock.now();
    if (blocked) this.blockedAt = now;
    else {
      const elapsed = now - this.blockedAt;
      if (preserveIdle || this.isSitting) this.lastActivity += elapsed;
      else this.lastActivity = now;
      if (this.restMode === 'sit') this.seatedAt += elapsed;
      if (preserveIdle) this.waveAt += elapsed;
      else this.resetWaveDeadline(now);
    }
    this.schedule();
  }

  activity(showBubble = false) {
    if (this.disposed) return null;
    this.lastActivity = this.clock.now();
    this.restMode = null;
    this.resetWaveDeadline(this.lastActivity);
    const response = showBubble
      ? INTERACTION_CONFIG.responses[Math.floor(this.random() * INTERACTION_CONFIG.responses.length)]
      : null;
    if (response && this.options.bubbles) {
      this.message = response.message;
      this.bubbleDeadline = this.lastActivity + INTERACTION_CONFIG.bubbleDurationMs;
    }
    this.onChange();
    this.schedule();
    return response;
  }

  finishSleepEnter() {
    if (this.restMode !== 'sleep_enter' || this.disposed) return;
    this.restMode = 'sleep_loop';
    this.onChange();
    this.schedule();
  }

  dismissBubble() {
    this.clearBubble();
    this.onChange();
    this.schedule();
  }

  dispose() {
    this.disposed = true;
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
    this.clearBubble();
  }

  private clearBubble() {
    this.message = null;
    this.bubbleDeadline = null;
  }

  private resetWaveDeadline(now: number) {
    const interval = INTERACTION_CONFIG.waveIntervalsMs[this.options.behaviorFrequency - 1];
    // Keep the phrase RNG independent of scheduling and space autonomous waves.
    this.waveAt = now + interval * (1 + Math.random() * 0.5);
  }

  private schedule() {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
    if (this.disposed) return;
    const deadlines: number[] = [];
    if (this.bubbleDeadline !== null) deadlines.push(this.bubbleDeadline);
    const sitAt = this.lastActivity + this.options.idleSeconds * 1_000;
    const sleepAt = Math.max(
      this.lastActivity + this.options.sleepTimeoutSeconds * 1_000,
      this.options.autoSit ? (this.restMode === 'sit' ? this.seatedAt : sitAt) + INTERACTION_CONFIG.sitTransitionMs : 0,
    );
    if (!this.blocked && !this.isSleeping) {
      if (this.options.autoSit && !this.isSitting) deadlines.push(sitAt);
      if (this.options.autoSleep) deadlines.push(sleepAt);
      if (this.options.randomWave && !this.isSitting && this.onRandomWave) deadlines.push(this.waveAt);
    }
    if (!deadlines.length) return;
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined;
      const now = this.clock.now();
      if (this.bubbleDeadline !== null && now >= this.bubbleDeadline) this.clearBubble();
      if (!this.blocked && !this.isSleeping) {
        if (this.options.autoSit && !this.isSitting && now >= sitAt) {
          this.restMode = 'sit';
          this.seatedAt = now;
        } else if (this.options.autoSleep && now >= sleepAt) {
          this.restMode = 'sleep_enter';
        } else if (this.options.randomWave && !this.isSitting && now >= this.waveAt) {
          this.resetWaveDeadline(now);
          this.onRandomWave?.();
        }
      }
      this.onChange();
      this.schedule();
    }, Math.max(1, Math.min(...deadlines) - this.clock.now()));
  }
}
