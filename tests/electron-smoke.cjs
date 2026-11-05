const { app, BrowserWindow, Menu, screen } = require('electron');
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
const watchdog = setTimeout(() => { console.error('SMOKE TIMEOUT'); app.exit(1); }, 65000);

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
  const snap = () => js('window.appBridge.getSnapshot()');
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
    assert.equal((await ui()).mode, 'idle');
    const saved = JSON.parse(fs.readFileSync(path.join(data, 'pixel-pet/pet-window.json'), 'utf8'));
    assert.deepEqual(pet.getPosition(), [saved.x, saved.y]);
    results.push('restart restores settings and saved visible position; runtime starts idle');
  } else {
    await js('window.petBridge.click()');
    await until(async () => (await ui()).mode === 'heart');
    const token = (await ui()).actionId;
    for (let i = 0; i < 30; i++) await js('window.petBridge.click()');
    assert.equal((await ui()).actionId, token);
    await until(() => BrowserWindow.getAllWindows().some(w => w !== pet && w.webContents.getURL().endsWith('/bubble.html')));
    const bubble = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/bubble.html'));
    assert.equal(bubble.isFocusable(), false);
    assert.equal(bubble.isFocused(), false);
    assert.equal(BrowserWindow.getAllWindows().length, 2);
    await until(async () => (await ui()).mode === 'idle');
    await until(() => !bubble.isVisible());
    results.push('30 rapid native IPC clicks: one HEART, one nonfocusable bubble; both finish');

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

    await js('window.petBridge.click()'); await until(async () => (await ui()).mode === 'heart');
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
    assert.ok((await js('document.querySelector(".pet-art").src')).endsWith('/idle_01.png'));
    await js('window.petBridge.click()');
    await until(async () => (await ui()).mode !== 'sit');
    await js('window.appBridge.setRoaming(false)');
    const stopped = pet.getPosition(); await wait(200);
    assert.deepEqual(pet.getPosition(), stopped);
    results.push('lock blocks drag/roaming; native 15s SIT stops movement with standing fallback; click wakes; stop does not jump');
    menu('隐藏桌宠'); assert.equal(pet.isVisible(), false);
    menu('显示桌宠'); assert.equal(pet.isVisible(), true);
    results.push('tray hide/show stays usable');
  }
  fs.writeFileSync(marker, JSON.stringify(reopen ? { ...JSON.parse(fs.readFileSync(marker, 'utf8')), reopenResults: results } : { data, results }, null, 2));
  console.log(JSON.stringify({ reopen, results, data }, null, 2));
  // Calling the real menu callback does not itself dismiss a native popup.
  for (const menu of nativeMenus) menu.closePopup();
  clearTimeout(watchdog); app.quit();
})().catch(error => { console.error(error); clearTimeout(watchdog); app.exit(1); });
