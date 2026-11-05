import React from 'react';
import { createRoot } from 'react-dom/client';
import type { AppSettings, AppSettingsPatch, AppSnapshot } from '../electron/settings-types';
import './settings.css';

type Category = 'general' | 'appearance' | 'behavior';

const CATEGORIES: { id: Category; icon: string; title: string; subtitle: string }[] = [
  { id: 'general', icon: '⌘', title: '常规', subtitle: '应用与启动' },
  { id: 'appearance', icon: '◉', title: '外观', subtitle: '角色显示' },
  { id: 'behavior', icon: '↗', title: '行为', subtitle: '漫步与互动' },
];

function ToggleRow({ title, detail, checked, disabled, onChange }: {
  title: string;
  detail?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return <label className={`setting-row toggle-row${disabled ? ' is-disabled' : ''}`}>
    <span className="setting-copy"><strong>{title}</strong>{detail && <small>{detail}</small>}</span>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    <span className="switch" aria-hidden="true"><span /></span>
  </label>;
}

function SliderRow({ title, detail, value, min, max, suffix = '', onChange }: {
  title: string;
  detail?: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return <div className="setting-row slider-row">
    <div className="setting-copy"><strong>{title}</strong>{detail && <small>{detail}</small>}</div>
    <div className="range-control">
      <input aria-label={title} type="range" min={min} max={max} step="1" value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <output>{value}{suffix}</output>
    </div>
  </div>;
}

function DurationRange({ title, minValue, maxValue, limit, onChange }: {
  title: string;
  minValue: number;
  maxValue: number;
  limit: number;
  onChange: (min: number, max: number) => void;
}) {
  return <div className="duration-range">
    <div className="duration-heading"><strong>{title}</strong><span>{minValue}–{maxValue} 秒</span></div>
    <div className="duration-controls">
      <label><span>最短</span><input aria-label={`${title}最短时间`} type="range" min="1" max={limit} value={minValue} onChange={(event) => {
        const next = Number(event.target.value);
        onChange(next, Math.max(next, maxValue));
      }} /></label>
      <label><span>最长</span><input aria-label={`${title}最长时间`} type="range" min="1" max={limit} value={maxValue} onChange={(event) => {
        const next = Number(event.target.value);
        onChange(Math.min(minValue, next), next);
      }} /></label>
    </div>
  </div>;
}

function SettingsApp() {
  const [snapshot, setSnapshot] = React.useState<AppSnapshot | null>(null);
  const [category, setCategory] = React.useState<Category>('general');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let active = true;
    void window.appBridge.getSnapshot().then((value) => { if (active) setSnapshot(value); });
    const unsubscribe = window.appBridge.onSnapshot((value) => setSnapshot(value));
    return () => { active = false; unsubscribe(); };
  }, []);

  const save = React.useCallback(async (patch: AppSettingsPatch) => {
    setSaving(true);
    setError('');
    try { setSnapshot(await window.appBridge.updateSettings(patch)); }
    catch { setError('设置保存失败，请重试。'); }
    finally { setSaving(false); }
  }, []);

  if (!snapshot) return <main className="settings-loading">正在读取设置…</main>;
  const { settings, runtime } = snapshot;
  const toggle = (key: keyof AppSettings) => (checked: boolean) => void save({ [key]: checked });

  return <main className="settings-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">P</span><span><strong>Pixel Pet</strong><small>桌宠设置</small></span></div>
      <nav aria-label="设置分类">
        {CATEGORIES.map((item) => <button key={item.id} className={`nav-item${category === item.id ? ' active' : ''}`} onClick={() => setCategory(item.id)}>
          <span className="nav-icon">{item.icon}</span><span><strong>{item.title}</strong><small>{item.subtitle}</small></span>
          <span className="nav-chevron">›</span>
        </button>)}
      </nav>
      <div className="sidebar-foot"><span className={`status-dot${runtime.petVisible ? ' online' : ''}`} />{runtime.petVisible ? '桌宠正在桌面上' : '桌宠已隐藏'}</div>
    </aside>

    <section className="settings-content">
      <header className="page-header">
        <div><p className="eyebrow">PREFERENCES</p><h1>{CATEGORIES.find((item) => item.id === category)?.title}设置</h1></div>
        <span className={`save-indicator${saving ? ' saving' : ''}`}><i />{saving ? '保存中' : '自动保存'}</span>
      </header>

      {category === 'general' && <>
        <section className="setting-card">
          <div className="card-heading"><h2>桌面宠物</h2><p>控制桌宠的显示方式与窗口层级。</p></div>
          <ToggleRow title="显示桌宠" detail="隐藏后可从菜单栏图标重新显示。" checked={runtime.petVisible} onChange={(value) => window.appBridge.setPetVisible(value)} />
          <ToggleRow title="始终置顶" detail="让桌宠保持在其他普通窗口上方。" checked={settings.alwaysOnTop} onChange={toggle('alwaysOnTop')} />
        </section>
        <section className="setting-card">
          <div className="card-heading"><h2>启动与菜单栏</h2><p>管理登录启动及应用入口。</p></div>
          <ToggleRow title="登录时自动启动" detail={runtime.launchAtLogin ? 'macOS 当前登录启动项已启用。' : settings.launchAtLogin ? '已保存启动偏好；macOS 当前未确认该登录项。开发版本需签名和公证后再验证。' : '开发版本的登录启动可能受 macOS 签名和公证限制。'} checked={settings.launchAtLogin} onChange={toggle('launchAtLogin')} />
          <ToggleRow title="启动应用后自动漫步" detail="启动时桌宠可见且允许漫步时生效。" checked={settings.autoStartRoaming} onChange={toggle('autoStartRoaming')} />
          <ToggleRow title="显示菜单栏图标" detail="从 macOS 菜单栏打开控制菜单和设置。" checked={settings.showMenuBarIcon} onChange={toggle('showMenuBarIcon')} disabled={!settings.showDockIcon && settings.showMenuBarIcon} />
          <ToggleRow title="显示 Dock 图标" detail="显示 Pixel Pet 的 Dock 应用图标。" checked={settings.showDockIcon} onChange={toggle('showDockIcon')} disabled={!settings.showDockIcon && !settings.showMenuBarIcon} />
        </section>
      </>}

      {category === 'appearance' && <>
        <section className="setting-card">
          <div className="card-heading"><h2>角色尺寸</h2><p>按比例缩放人物和透明窗口，像素素材保持原样。</p></div>
          <SliderRow title="人物显示大小" detail="60%–150%，缩放时保持宽高比例。" min={60} max={150} value={settings.petScalePercent} suffix="%" onChange={(value) => void save({ petScalePercent: value })} />
          <div className="preview-note"><span className="preview-sparkle">✦</span><span><strong>像素清晰度已保留</strong><small>人物使用最近邻缩放显示，尺寸调整不会重绘素材。</small></span></div>
        </section>
      </>}

      {category === 'behavior' && <>
        <section className="setting-card">
          <div className="card-heading"><h2>自主漫步</h2><p>设置移动速度和走动、停留节奏。</p></div>
          <ToggleRow title="允许自主漫步" detail="关闭后，菜单和设置中的漫步开关都不可用。" checked={settings.allowAutonomousRoaming} onChange={toggle('allowAutonomousRoaming')} />
          <ToggleRow title="自主漫步已开启" detail="休息或坐下时暂不移动；位置锁定或隐藏桌宠时无法启动。" checked={runtime.roaming} disabled={!settings.allowAutonomousRoaming || lockedUnavailable(runtime)} onChange={(value) => window.appBridge.setRoaming(value)} />
          <SliderRow title="漫步速度" detail="每秒移动的屏幕逻辑像素（DIP）。" min={10} max={120} value={settings.roamingSpeedDipPerSecond} suffix=" DIP/s" onChange={(value) => void save({ roamingSpeedDipPerSecond: value })} />
        </section>
        <section className="setting-card">
          <div className="card-heading"><h2>行为节奏</h2><p>每轮在设定范围内随机选择时长。</p></div>
          <DurationRange title="每次行走" minValue={settings.minWalkSeconds} maxValue={settings.maxWalkSeconds} limit={60} onChange={(min, max) => void save({ minWalkSeconds: min, maxWalkSeconds: max })} />
          <DurationRange title="每次停留" minValue={settings.minRestSeconds} maxValue={settings.maxRestSeconds} limit={120} onChange={(min, max) => void save({ minRestSeconds: min, maxRestSeconds: max })} />
        </section>
        <section className="setting-card">
          <div className="card-heading"><h2>互动</h2><p>选择角色对鼠标操作的回应。</p></div>
          <ToggleRow title="点击人物触发比心" detail="关闭后，点击不播放比心动画，拖动功能不受影响。" checked={settings.allowClickHeart} onChange={toggle('allowClickHeart')} />
          <ToggleRow title="互动文字气泡" detail="点击显示一条短句，约 2.6 秒后消失；气泡不会抢焦点。" checked={settings.interactionBubbles} onChange={toggle('interactionBubbles')} />
          <ToggleRow title="空闲后自动坐下" detail="暂停漫步并保持休息；缺少坐姿素材时静止站立。点击或拖动唤醒。" checked={settings.autoSit} onChange={toggle('autoSit')} />
          <SliderRow title="自动坐下等待时间" detail="距离上次互动的秒数，默认 60 秒。" min={15} max={600} value={settings.idleSitSeconds} suffix=" 秒" onChange={(value) => void save({ idleSitSeconds: value })} />
        </section>
      </>}

      <footer className="page-footer">
        <span className="footer-message">{error || '更改会自动保存到此 Mac。'}</span>
        <button className="reset-button" onClick={async () => {
          setSaving(true); setError('');
          try { setSnapshot(await window.appBridge.resetSettings()); }
          catch { setError('恢复默认设置失败，请重试。'); }
          finally { setSaving(false); }
        }}>恢复默认设置</button>
      </footer>
    </section>
  </main>;
}

function lockedUnavailable(runtime: AppSnapshot['runtime']) {
  return runtime.locked || !runtime.petVisible;
}

const root = createRoot(document.getElementById('root')!);
root.render(<React.StrictMode><SettingsApp /></React.StrictMode>);

if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
