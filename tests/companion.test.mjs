import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InteractionController } from '../dist-electron/interaction-controller.js';
import { WanderController } from '../dist-electron/wander-controller.js';
import { SettingsStore } from '../dist-electron/settings-store.js';
import { DEFAULT_APP_SETTINGS, normalizeAppSettings, validateSettingsPatch } from '../dist-electron/settings-types.js';
import { animationStateFor } from '../dist-electron/pet-state.js';
import { bubbleBounds, bubbleLayout } from '../dist-electron/window-geometry.js';

class Clock {
  time = 0;
  sequence = 0;
  tasks = new Map();
  now = () => this.time;
  setTimeout = (callback, delay) => {
    const id = ++this.sequence;
    this.tasks.set(id, { at: this.time + delay, callback });
    return id;
  };
  clearTimeout = id => { this.tasks.delete(id); };
  advance(ms) {
    const end = this.time + ms;
    let guard = 0;
    while (true) {
      const next = [...this.tasks].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      assert.ok(++guard < 100_000, 'timer loop did not terminate');
      this.time = next[1].at;
      this.tasks.delete(next[0]);
      next[1].callback();
    }
    this.time = end;
  }
}

function makeWander(clock) {
  let displays = [{ id: 1, workArea: { x: -1440, y: -900, width: 1440, height: 876 } }];
  let bounds = { x: -1100, y: -700, width: 160, height: 220 };
  const modes = [];
  let locked = false;
  const window = {
    isDestroyed: () => false,
    getBounds: () => ({ ...bounds }),
    getPosition: () => [bounds.x, bounds.y],
    setPosition: (x, y) => { bounds = { ...bounds, x, y }; },
  };
  const controller = new WanderController({
    getAllDisplays: () => displays,
    getDisplayNearestPoint: () => displays[0],
  }, {
    getWindow: () => window, isLocked: () => locked,
    onModeChange: mode => modes.push(mode), onFacingChange: () => {},
    onEnabledChange: () => {}, persistPosition: () => {},
  }, clock);
  controller.configure({ speedDipPerSecond: 30, minRestMs: 1000, maxRestMs: 1000, minWalkMs: 8000, maxWalkMs: 8000 });
  return { controller, window, modes, display: area => { displays = [{ id: 2, workArea: area }]; }, lock: () => { locked = true; } };
}

test('60-second inactivity sits once, interaction wakes, and disposal clears the deadline', () => {
  const clock = new Clock();
  let changes = 0;
  const controller = new InteractionController(() => changes++, clock);
  controller.setBlocked(false);
  clock.advance(59_999);
  assert.equal(controller.isSitting, false);
  clock.advance(1);
  assert.equal(controller.isSitting, true);
  assert.equal(changes, 1);
  assert.equal(clock.tasks.size, 0);
  controller.activity();
  assert.equal(controller.isSitting, false);
  assert.equal(clock.tasks.size, 1);
  controller.dispose();
  assert.equal(clock.tasks.size, 0);
});

test('rapid clicks replace one bubble and share one timer; disabling clears it', () => {
  const clock = new Clock();
  const controller = new InteractionController(() => {}, clock);
  controller.setBlocked(false);
  for (let index = 0; index < 100; index++) {
    controller.activity(true);
    assert.equal(clock.tasks.size, 1);
    clock.advance(10);
  }
  assert.ok(controller.bubble.message);
  clock.advance(2600);
  assert.equal(controller.bubble.message, null);
  controller.activity(true);
  controller.configure({ autoSit: false, idleSeconds: 60, bubbles: false });
  assert.equal(controller.bubble.message, null);
  assert.equal(clock.tasks.size, 0);
  controller.dispose();
});

test('pause, drag and one-shot blockers do not cause an overdue sit on resume', () => {
  const clock = new Clock();
  const controller = new InteractionController(() => {}, clock);
  controller.setBlocked(false);
  clock.advance(50_000);
  controller.setBlocked(true);
  clock.advance(120_000);
  assert.equal(controller.isSitting, false);
  assert.equal(clock.tasks.size, 0);
  controller.setBlocked(false);
  clock.advance(59_999);
  assert.equal(controller.isSitting, false);
  clock.advance(1);
  assert.equal(controller.isSitting, true);
  controller.configure({ autoSit: false, idleSeconds: 60, bubbles: true });
  assert.equal(controller.isSitting, false);
  controller.dispose();
});

test('SIT suspends roaming without moving the window; wake resumes and stop leaves position intact', () => {
  const clock = new Clock();
  const { controller, window } = makeWander(clock);
  let interaction;
  interaction = new InteractionController(() => controller.setPaused(interaction.isSitting), clock);
  interaction.setBlocked(false);
  controller.start();
  clock.advance(60_000);
  assert.equal(interaction.isSitting, true);
  const restingPosition = window.getPosition();
  clock.advance(60_000);
  assert.deepEqual(window.getPosition(), restingPosition);
  assert.equal(clock.tasks.size, 0);
  interaction.activity();
  assert.deepEqual(window.getPosition(), restingPosition);
  clock.advance(9000);
  assert.notDeepEqual(window.getPosition(), restingPosition);
  const finalPosition = window.getPosition();
  controller.stop();
  clock.advance(1000);
  assert.deepEqual(window.getPosition(), finalPosition);
  interaction.dispose(); controller.dispose();
  assert.equal(clock.tasks.size, 0);
});

test('drag interrupts HEART and resumes roaming without a stranded interaction flag', () => {
  const clock = new Clock();
  const { controller, window } = makeWander(clock);
  controller.start(); clock.advance(1330);
  controller.beginAction('heart');
  const before = window.getPosition();
  clock.advance(2000);
  assert.deepEqual(window.getPosition(), before);
  controller.onManualDragStarted();
  controller.onManualDragEnded();
  assert.equal(controller.currentMode, 'walk');
  assert.equal(clock.tasks.size, 1);
  clock.advance(330);
  assert.notDeepEqual(window.getPosition(), before);
  controller.dispose();
  assert.equal(clock.tasks.size, 0);
});

test('pause + drag restores correctly; locked position cannot start roaming', () => {
  const clock = new Clock();
  const { controller, window, lock } = makeWander(clock);
  controller.start(); clock.advance(1330);
  controller.setPaused(true);
  controller.beginAction('heart');
  controller.onManualDragStarted(); controller.onManualDragEnded();
  const before = window.getPosition();
  clock.advance(1000);
  assert.deepEqual(window.getPosition(), before);
  controller.setPaused(false); clock.advance(330);
  assert.notDeepEqual(window.getPosition(), before);
  controller.stop(); lock();
  assert.equal(controller.start(), false);
  assert.equal(clock.tasks.size, 0);
  controller.dispose();
});

test('standing transition suspends roaming until complete and can be cancelled by drag', () => {
  const clock = new Clock();
  const { controller, window } = makeWander(clock);
  controller.start(); clock.advance(1330);
  const position = window.getPosition();
  controller.beginAction('stand');
  clock.advance(670);
  assert.equal(controller.currentMode, 'stand');
  assert.deepEqual(window.getPosition(), position);
  controller.finishAction();
  assert.equal(controller.currentMode, 'walk');
  assert.deepEqual(window.getPosition(), position);
  clock.advance(330);
  assert.notDeepEqual(window.getPosition(), position);
  controller.beginAction('stand');
  controller.onManualDragStarted();
  controller.onManualDragEnded();
  assert.equal(controller.currentMode, 'walk');
  assert.equal(clock.tasks.size, 1);
  controller.dispose();
  assert.equal(clock.tasks.size, 0);
});

test('negative-origin display, edge turns and display removal keep full window in workArea', () => {
  const clock = new Clock();
  const { controller, window, display } = makeWander(clock);
  window.setPosition(-161, -700);
  controller.configure({ speedDipPerSecond: 120, minRestMs: 1000, maxRestMs: 1000, minWalkMs: 8000, maxWalkMs: 8000 });
  controller.start(); clock.advance(1100);
  assert.equal(controller.direction, 'left');
  for (let index = 0; index < 100; index++) {
    clock.advance(330);
    const [x, y] = window.getPosition();
    assert.ok(x >= -1440 && x <= -160);
    assert.ok(y >= -900 && y <= -244);
  }
  display({ x: 100, y: 200, width: 800, height: 600 });
  controller.onDisplayConfigurationChanged();
  const [x, y] = window.getPosition();
  assert.ok(x >= 100 && x <= 740);
  assert.ok(y >= 200 && y <= 580);
  controller.dispose();
});

test('bubble placement remains visible above/left of the primary screen and on tiny workAreas', () => {
  for (const area of [{ x: -1920, y: -1080, width: 1920, height: 1040 }, { x: 120, y: 40, width: 100, height: 50 }]) {
    for (const y of [area.y, area.y + area.height - 220]) {
      const result = bubbleBounds({ x: area.x, y, width: 160, height: 220 }, area);
      assert.ok(result.x >= area.x && result.x + result.width <= area.x + area.width);
      assert.ok(result.y >= area.y && result.y + result.height <= area.y + area.height);
    }
  }
});

test('state projection has drag priority, paused state and directional walks', () => {
  const base = { paused: false, mode: 'idle', direction: 'left' };
  assert.equal(animationStateFor({ ...base, mode: 'walk' }), 'WALK_LEFT');
  assert.equal(animationStateFor({ ...base, mode: 'walk', direction: 'right' }), 'WALK_RIGHT');
  assert.equal(animationStateFor({ ...base, paused: true, mode: 'dragging' }), 'DRAGGING');
  assert.equal(animationStateFor({ ...base, paused: true }), 'PAUSED');
  assert.equal(animationStateFor({ ...base, mode: 'sit' }), 'SIT');
  assert.equal(animationStateFor({ ...base, mode: 'stand' }), 'STAND');
});

test('bubble placement changes at the top edge using the same rule as its bounds', () => {
  const area = { x: -1920, y: -1080, width: 1920, height: 1040 };
  for (const [offset, placement] of [[0, 'below'], [51, 'below'], [52, 'above'], [300, 'above']]) {
    const pet = { x: -1500, y: area.y + offset, width: 160, height: 220 };
    const layout = bubbleLayout(pet, area);
    assert.equal(layout.placement, placement);
    assert.deepEqual(layout.bounds, bubbleBounds(pet, area));
    if (placement === 'below') assert.ok(layout.bounds.y > pet.y);
    else assert.ok(layout.bounds.y < pet.y);
  }
});

test('settings migrate v1, reject invalid patches, persist on restart, and recover corrupt files', () => {
  const folder = mkdtempSync(join(tmpdir(), 'pixel-pet-settings-test-'));
  try {
    const path = join(folder, 'settings.json');
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, roamingSpeedDipPerSecond: 60, petScalePercent: 150 }));
    const store = new SettingsStore(path);
    assert.equal(store.value.schemaVersion, 2);
    assert.equal(store.value.idleSitSeconds, 60);
    assert.equal(store.value.roamingSpeedDipPerSecond, 60);
    store.update({ autoSit: false, idleSitSeconds: 90, interactionBubbles: false });
    assert.deepEqual(new SettingsStore(path).value, store.value);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).interactionBubbles, false);
    assert.equal(validateSettingsPatch({ idleSitSeconds: 0 }), false);
    assert.equal(validateSettingsPatch({ idleSitSeconds: NaN }), false);
    assert.equal(validateSettingsPatch({ interactionBubbles: 'yes' }), false);
    assert.equal(validateSettingsPatch({ autoSit: false, interactionBubbles: true }), true);
    assert.equal(normalizeAppSettings({ idleSitSeconds: 9999 }).idleSitSeconds, 600);
    assert.equal(normalizeAppSettings({ idleSitSeconds: NaN }).idleSitSeconds, 60);
    writeFileSync(path, '{bad json');
    assert.deepEqual(new SettingsStore(path).value, DEFAULT_APP_SETTINGS);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
