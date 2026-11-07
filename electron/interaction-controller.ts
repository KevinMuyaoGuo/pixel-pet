import { SYSTEM_CLOCK, type ControllerClock } from './controller-clock.js';

export const INTERACTION_CONFIG = {
  bubbleDurationMs: 2_600,
  responses: [
    { message: '你好呀！', action: 'wave' },
    { message: '在干嘛？', action: null },
    { message: '休息一下吧~', action: null },
    { message: '今天也要想我哦~', action: null },
    { message: '爱你哦~', action: 'heart' },
  ],
} as const;

type Options = { autoSit: boolean; idleSeconds: number; bubbles: boolean };

/** Owns one deadline timer for inactivity and one replaceable text bubble. */
export class InteractionController {
  private options: Options = { autoSit: true, idleSeconds: 60, bubbles: true };
  private blocked = true;
  private sitting = false;
  private lastActivity: number;
  private bubbleDeadline: number | null = null;
  private message: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly onChange: () => void, private readonly clock: ControllerClock = SYSTEM_CLOCK, private readonly random: () => number = () => Math.random()) {
    this.lastActivity = clock.now();
  }

  get isSitting() { return this.sitting; }
  get bubble() { return { message: this.message }; }

  configure(options: Options) {
    this.options = { ...options };
    if (!options.autoSit) this.sitting = false;
    if (!options.bubbles) this.clearBubble();
    this.onChange();
    this.schedule();
  }

  setBlocked(blocked: boolean) {
    if (this.blocked === blocked || this.disposed) return;
    this.blocked = blocked;
    // Pauses and one-shot actions should never cause an overdue sit on resume.
    if (!blocked) this.lastActivity = this.clock.now();
    this.schedule();
  }

  activity(showBubble = false) {
    if (this.disposed) return null;
    this.lastActivity = this.clock.now();
    this.sitting = false;
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

  private schedule() {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
    if (this.disposed) return;
    const deadlines: number[] = [];
    if (this.bubbleDeadline !== null) deadlines.push(this.bubbleDeadline);
    if (this.options.autoSit && !this.blocked && !this.sitting) {
      deadlines.push(this.lastActivity + this.options.idleSeconds * 1_000);
    }
    if (!deadlines.length) return;
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined;
      const now = this.clock.now();
      if (this.bubbleDeadline !== null && now >= this.bubbleDeadline) this.clearBubble();
      if (this.options.autoSit && !this.blocked && now >= this.lastActivity + this.options.idleSeconds * 1_000) {
        this.sitting = true;
      }
      this.onChange();
      this.schedule();
    }, Math.max(1, Math.min(...deadlines) - this.clock.now()));
  }
}
