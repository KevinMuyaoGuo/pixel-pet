const { app, BrowserWindow, Menu, powerMonitor, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
if (process.platform !== 'darwin') throw new Error('This native smoke test requires macOS.');
const root = path.resolve(__dirname, '..');
const devURL = process.env.PIXEL_PET_DEV_URL ?? 'http://127.0.0.1:5178';
const marker = path.join(require('node:os').tmpdir(), 'pixel-pet-v06-session.json');
const reopen = process.argv.includes('--reopen');
const data = reopen ? JSON.parse(fs.readFileSync(marker, 'utf8')).data : fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pixel-pet-v06-'));
app.setPath('appData', data);
const menus = [];
const nativeMenus = [];
const buildMenu = Menu.buildFromTemplate.bind(Menu);
Menu.buildFromTemplate = template => {
  menus.push(template);
  if (menus.length > 100) menus.shift();
  const menu = buildMenu(template);
  nativeMenus.push(menu);
  return menu;
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, limit = 10000) {
  const end = Date.now() + limit;
  while (Date.now() < end) { if (await predicate()) return; await wait(50); }
  throw new Error('Timed out waiting for native app state');
}
const results = [];
const watchdog = setTimeout(() => { console.error('SMOKE TIMEOUT'); app.exit(1); }, 125000);

(async () => {
  if (!reopen) {
    const { DEFAULT_APP_SETTINGS } = await import(path.join(root, 'dist-electron/settings-types.js'));
    fs.mkdirSync(path.join(data, 'pixel-pet'), { recursive: true });
    fs.writeFileSync(path.join(data, 'pixel-pet/settings.json'), JSON.stringify({ ...DEFAULT_APP_SETTINGS, idleSitSeconds: 15 }));
  }
  await import(path.join(root, 'dist-electron/main.js'));
  await app.whenReady();
  await until(() => BrowserWindow.getAllWindows().some(w => w.webContents.getURL().startsWith(`${devURL}/`)));
  const pet = BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === `${devURL}/`);
  const js = code => pet.webContents.executeJavaScript(code);
  await until(async () => await js('Boolean(window.petBridge && document.querySelector(".pet-art"))'));
  await until(async () => await js('document.querySelector(".pet-art").complete'));
  const ui = () => js('window.petBridge.getUiState()');
  const visibleArt = () => js(`(async () => {
    const image = document.querySelector('.pet-art');
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let top = canvas.height, bottom = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3] >= 128) { top = Math.min(top, y); bottom = Math.max(bottom, y + 1); }
    }
    const bounds = image.getBoundingClientRect();
    return { height: (bottom - top) / canvas.height * bounds.height, bottom: bounds.top + bottom / canvas.height * bounds.height };
  })()`);
  const snap = () => js('window.appBridge.getSnapshot()');
  const clickResponse = async index => {
    const random = Math.random;
    Math.random = () => (index + 0.5) / 5;
    try { await js('window.petBridge.click()'); await ui(); }
    finally { Math.random = random; }
  };
  const menu = label => { const template = [...menus].reverse().find(items => items.some(i => i.label === label)); assert.ok(template, `menu ${label}`); template.find(i => i.label === label).click(); };
  assert.equal(pet.webContents.getLastWebPreferences().contextIsolation, true);
  assert.equal(pet.webContents.getLastWebPreferences().nodeIntegration, false);
  assert.equal(pet.isAlwaysOnTop(), true);
  assert.equal(await js('getComputedStyle(document.body).backgroundColor'), 'rgba(0, 0, 0, 0)');
  results.push('native transparent always-on-top pet and isolated preload');
  if (reopen) {
    const settings = (await snap()).settings;
    assert.equal(settings.roamingSpeedDipPerSecond, 120);
    assert.equal(settings.idleSitSeconds, 15);
    assert.equal(settings.allowClickHeart, false);
    assert.equal(settings.autoSleep, true);
    assert.equal(settings.sleepTimeoutSeconds, 30);
    assert.equal(settings.randomWave, false);
    assert.equal(settings.behaviorFrequency, 3);
    assert.equal((await ui()).mode, 'idle');
    const saved = JSON.parse(fs.readFileSync(path.join(data, 'pixel-pet/pet-window.json'), 'utf8'));
    assert.deepEqual(pet.getPosition(), [saved.x, saved.y]);
    results.push('restart restores settings and saved visible position; runtime starts idle');
  } else {
    await clickResponse(4);
    await until(async () => (await ui()).mode === 'heart');
    const token = (await ui()).actionId;
    for (let i = 0; i < 30; i++) await js('window.petBridge.click()');
    assert.equal((await ui()).actionId, token);
    await until(() => BrowserWindow.getAllWindows().some(w => w !== pet && w.webContents.getURL().endsWith('/bubble.html')));
    const bubble = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/bubble.html'));
    assert.equal(bubble.isFocusable(), false);
    assert.equal(bubble.isFocused(), false);
    assert.equal(BrowserWindow.getAllWindows().length, 2);
    await until(async () => await bubble.webContents.executeJavaScript('document.querySelectorAll(".speech-bubble").length === 1'));
    assert.equal(await bubble.webContents.executeJavaScript('document.querySelector(".speech-bubble").textContent'), '爱你哦~');
    await until(async () => (await ui()).mode === 'idle');
    await until(() => !bubble.isVisible());
    results.push('30 rapid native IPC clicks: one HEART, one nonfocusable bubble; both finish');

    for (const [index, phrase] of [[1, '在干嘛？'], [2, '休息一下吧~'], [3, '今天也要想我哦~']]) {
      await clickResponse(index);
      await until(async () => await bubble.webContents.executeJavaScript(`document.querySelector('.speech-bubble')?.textContent === ${JSON.stringify(phrase)}`));
      assert.equal((await ui()).mode, 'idle');
      assert.equal((await ui()).actionId, null);
    }
    await js('window.petBridge.showContextMenu()');
    assert.equal(menus.at(-1).some(item => item.label === '挥手'), false);
    results.push('all three unassigned phrases leave the pet idle; original right-click menu has no Wave item');

    const bubbleArea = screen.getDisplayMatching(pet.getBounds()).workArea;
    const originalPosition = pet.getPosition();
    pet.setPosition(originalPosition[0], bubbleArea.y);
    await js('window.petBridge.click()');
    await until(() => bubble.isVisible());
    await until(async () => await bubble.webContents.executeJavaScript('document.querySelector(".speech-bubble")?.dataset.placement === "below"'));
    assert.equal(await bubble.webContents.executeJavaScript('getComputedStyle(document.querySelector(".speech-bubble"), "::after").top'), '-7px');
    pet.setPosition(originalPosition[0], bubbleArea.y + 100);
    await until(async () => await bubble.webContents.executeJavaScript('document.querySelector(".speech-bubble")?.dataset.placement === "above"'));
    assert.equal(await bubble.webContents.executeJavaScript('getComputedStyle(document.querySelector(".speech-bubble"), "::after").bottom'), '-7px');
    pet.setPosition(...originalPosition);
    await until(async () => (await ui()).mode === 'idle');
    results.push('top-edge bubble points upward; moving back below threshold restores downward tail while bubble remains visible');

    await js('window.appBridge.openSettings()');
    await until(() => BrowserWindow.getAllWindows().some(w => w.webContents.getURL().endsWith('/settings.html')));
    const settingsWindow = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/settings.html'));
    await until(async () => settingsWindow.webContents.executeJavaScript('Boolean(document.querySelector(".settings-shell"))'));
    await settingsWindow.webContents.executeJavaScript('window.appBridge.updateSettings({roamingSpeedDipPerSecond:120,minRestSeconds:1,maxRestSeconds:1,minWalkSeconds:8,maxWalkSeconds:8})');
    assert.equal((await snap()).settings.roamingSpeedDipPerSecond, 120);
    for (const scale of [60, 150, 100]) {
      await js(`window.appBridge.updateSettings({petScalePercent:${scale}})`);
      await until(async () => Math.round(await js('document.querySelector(".pet-art").getBoundingClientRect().height')) === Math.round(180 * scale / 100));
      assert.equal(pet.getBounds().height, Math.round(220 * scale / 100));
      assert.equal(pet.getBounds().width, Math.round(160 * scale / 100));
    }
    settingsWindow.close();
    assert.equal(pet.isDestroyed(), false);
    results.push('settings IPC persists and synchronizes; 60/150/100% native sizing; settings close keeps pet alive');

    const area = screen.getDisplayMatching(pet.getBounds()).workArea;
    pet.setPosition(Math.round(area.x + (area.width - pet.getBounds().width) / 2), Math.round(area.y + (area.height - pet.getBounds().height) / 2));
    await js('window.appBridge.setRoaming(true)');
    await until(async () => (await ui()).mode === 'walk');
    await js('window.appBridge.setRoaming(true)');
    assert.equal((await ui()).mode, 'walk');
    const start = pet.getPosition(); await wait(400);
    assert.notDeepEqual(pet.getPosition(), start);
    menu('暂停动画');
    await until(async () => await js('document.querySelector("main").dataset.mode === "paused"'));
    const frozen = pet.getPosition();
    const frozenFrame = await js('document.querySelector(".pet-art").src');
    await wait(400);
    assert.deepEqual(pet.getPosition(), frozen);
    assert.equal(await js('document.querySelector(".pet-art").src'), frozenFrame);
    menu('恢复动画');
    await wait(400);
    assert.notDeepEqual(pet.getPosition(), frozen);
    results.push('native roaming moves; tray pause freezes frames and coordinates; resume works');

    await js('window.petBridge.showContextMenu()');
    await js(`window.waveFrames = []; window.waveObserver = new MutationObserver(() => {
      const src = document.querySelector('.pet-art').src;
      if (src.includes('/wave/')) window.waveFrames.push(src.split('/').pop());
    }); window.waveObserver.observe(document.querySelector('.pet-art'), { attributes: true, attributeFilter: ['src'] });`);
    await clickResponse(0);
    await until(async () => (await ui()).mode === 'wave');
    await until(async () => await bubble.webContents.executeJavaScript('document.querySelector(".speech-bubble")?.textContent === "你好呀！"'));
    const wavePosition = pet.getPosition();
    const waveArt = await visibleArt();
    await until(async () => (await js('document.querySelector(".pet-art").src')).endsWith('/wave_02.png'));
    menu('暂停动画');
    await until(async () => await js('document.querySelector("main").dataset.mode === "paused"'));
    const pausedWave = await js('document.querySelector(".pet-art").src');
    await wait(400);
    assert.equal(await js('document.querySelector(".pet-art").src'), pausedWave);
    assert.deepEqual(pet.getPosition(), wavePosition);
    menu('恢复动画');
    await until(async () => (await ui()).mode === 'idle');
    assert.deepEqual(await js('window.waveObserver.disconnect(); [...new Set(window.waveFrames)]'), ['wave_01.png', 'wave_02.png', 'wave_03.png', 'wave_04.png', 'wave_05.png', 'wave_06.png']);
    const idleArt = await visibleArt();
    assert.ok(Math.abs(waveArt.height - idleArt.height) < 0.5, 'wave and idle have the same visible character height');
    assert.ok(Math.abs(waveArt.bottom - idleArt.bottom) < 0.5, 'wave and idle feet stay aligned');
    assert.deepEqual(pet.getPosition(), wavePosition);
    assert.equal((await ui()).roaming, true);
    await until(async () => (await ui()).mode === 'walk');
    results.push('Hello click plays six Wave frames once, pause freezes it, returns to idle without moving or shifting the image baseline, then roaming resumes');

    await clickResponse(4); await until(async () => (await ui()).mode === 'heart');
    const oldToken = (await ui()).actionId;
    const [x,y] = pet.getPosition();
    await js(`window.petBridge.beginDrag({screenX:${x},screenY:${y}})`);
    await until(async () => (await ui()).mode === 'dragging');
    await js(`window.petBridge.finishAction(${oldToken})`);
    assert.equal((await ui()).mode, 'dragging');
    await js(`window.petBridge.dragTo({screenX:${x-30},screenY:${y-30}});window.petBridge.endDrag()`);
    await until(async () => (await ui()).mode === 'walk');
    results.push('drag cancels HEART; stale completion ignored; roaming resumes');

    await js('window.petBridge.showContextMenu()');
    Menu.getApplicationMenu();
    menu('锁定位置');
    assert.equal((await ui()).locked, true);
    const locked = pet.getPosition();
    await js('window.appBridge.setRoaming(true); window.petBridge.beginDrag({screenX:1,screenY:1}); window.petBridge.dragTo({screenX:99,screenY:99})');
    await wait(100);
    assert.deepEqual(pet.getPosition(), locked);
    assert.equal((await ui()).roaming, false);
    await js('window.petBridge.showContextMenu()'); menu('解除位置锁定');
    await js('window.appBridge.updateSettings({allowClickHeart:false}); window.appBridge.setRoaming(true)');
    await until(async () => (await ui()).mode === 'sit', 20000);
    const seated = pet.getPosition();
    await wait(400);
    assert.deepEqual(pet.getPosition(), seated);
    assert.equal((await ui()).roaming, true);
    const hasSitFrames = ['01', '02', '03', '04'].every(frame => fs.existsSync(path.join(root, `public/animations/sit/sit_${frame}.png`)));
    if (hasSitFrames) {
      await until(async () => (await js('document.querySelector(".pet-art").src')).endsWith('/sit_04.png'));
      menu('暂停动画');
      await js('window.petBridge.hover(3)');
      assert.equal((await ui()).mode, 'sit');
      menu('恢复动画');
      await js('window.petBridge.hover(3)');
      await until(async () => (await ui()).mode === 'stand');
      const standId = (await ui()).actionId;
      await js('window.petBridge.hover(3)');
      assert.equal((await ui()).actionId, standId);
      await wait(200);
      assert.deepEqual(pet.getPosition(), seated);
      await until(async () => (await ui()).mode !== 'stand');
    } else {
      assert.ok((await js('document.querySelector(".pet-art").src')).endsWith('/idle_01.png'));
    }
    await js('window.petBridge.click()');
    await until(async () => (await ui()).mode !== 'sit');
    await js('window.appBridge.setRoaming(false)');
    const stopped = pet.getPosition(); await wait(200);
    assert.deepEqual(pet.getPosition(), stopped);
    results.push('lock blocks drag/roaming; SIT holds pose; hover stands once without moving until complete; paused hover ignored; click wakes fallback; stop does not jump');
    menu('隐藏桌宠'); assert.equal(pet.isVisible(), false);
    menu('显示桌宠'); assert.equal(pet.isVisible(), true);
    results.push('tray hide/show stays usable');
    await js('window.appBridge.updateSettings({autoSit:true, idleSitSeconds:15, autoSleep:true, sleepTimeoutSeconds:30, randomWave:false, behaviorFrequency:3})');
    await js('window.appBridge.setRoaming(true)');
    await until(async () => (await ui()).mode === 'sit', 20_000);
    await until(async () => (await ui()).mode === 'sleep_enter', 20_000);
    const enterId = (await ui()).actionId;
    await until(async () => (await ui()).mode === 'sleep_loop');
    const sleepPosition = pet.getPosition();
    const sleepFrame = () => js('document.querySelector(".pet-art").src');
    await until(async () => (await sleepFrame()).includes('/sleep_loop/'));
    const firstLoopFrame = await sleepFrame();
    await until(async () => (await sleepFrame()) !== firstLoopFrame);
    powerMonitor.emit('suspend');
    await until(async () => await js('document.querySelector("main").dataset.mode === "paused"'));
    const frozenSleepFrame = await sleepFrame();
    await wait(650);
    assert.equal(await sleepFrame(), frozenSleepFrame);
    assert.deepEqual(pet.getPosition(), sleepPosition);
    powerMonitor.emit('resume');
    await until(async () => (await sleepFrame()) !== frozenSleepFrame);
    await js('window.petBridge.click()');
    await until(async () => (await ui()).mode === 'sleep_exit');
    const wakeId = (await ui()).actionId;
    await js(`window.petBridge.finishAction(${enterId}); for (let i = 0; i < 30; i++) window.petBridge.click()`);
    assert.equal((await ui()).actionId, wakeId);
    await until(async () => (await sleepFrame()).endsWith('/sleep_exit_04.png'));
    await until(async () => (await ui()).mode === 'stand');
    const wakeStandId = (await ui()).actionId;
    await js(`window.petBridge.finishAction(${wakeId}); window.petBridge.click()`);
    assert.equal((await ui()).actionId, wakeStandId);
    assert.deepEqual(pet.getPosition(), sleepPosition);
    await until(async () => (await sleepFrame()).endsWith('/sit_01.png'));
    await until(async () => (await ui()).mode === 'idle');
    assert.deepEqual(pet.getPosition(), sleepPosition);
    assert.equal((await ui()).roaming, true);
    results.push('sleep enter and loop, simulated suspend/resume, rapid click wakes once, stands, and finishes in idle');

  }
  fs.writeFileSync(marker, JSON.stringify(reopen ? { ...JSON.parse(fs.readFileSync(marker, 'utf8')), reopenResults: results } : { data, results }, null, 2));
  console.log(JSON.stringify({ reopen, results, data }, null, 2));
  // Calling the real menu callback does not itself dismiss a native popup.
  for (const menu of nativeMenus) menu.closePopup();
  clearTimeout(watchdog); app.quit();
})().catch(error => { console.error(error); clearTimeout(watchdog); app.exit(1); });
