export const SETTINGS_SCHEMA_VERSION = 3;

export type AppSettings = {
  schemaVersion: number;
  showPet: boolean;
  alwaysOnTop: boolean;
  launchAtLogin: boolean;
  autoStartRoaming: boolean;
  showMenuBarIcon: boolean;
  showDockIcon: boolean;
  petScalePercent: number;
  allowClickHeart: boolean;
  allowAutonomousRoaming: boolean;
  roamingSpeedDipPerSecond: number;
  minWalkSeconds: number;
  maxWalkSeconds: number;
  minRestSeconds: number;
  maxRestSeconds: number;
  autoSit: boolean;
  autoSleep: boolean;
  sleepTimeoutSeconds: number;
  randomWave: boolean;
  behaviorFrequency: number;
  idleSitSeconds: number;
  interactionBubbles: boolean;
};

export type AppSettingsPatch = Partial<Omit<AppSettings, 'schemaVersion'>>;

export type AppSnapshot = {
  settings: AppSettings;
  runtime: {
    petVisible: boolean;
    roaming: boolean;
    paused: boolean;
    locked: boolean;
    launchAtLogin: boolean;
  };
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  showPet: true,
  alwaysOnTop: true,
  launchAtLogin: false,
  autoStartRoaming: false,
  showMenuBarIcon: true,
  showDockIcon: true,
  petScalePercent: 100,
  allowClickHeart: true,
  allowAutonomousRoaming: true,
  roamingSpeedDipPerSecond: 30,
  minWalkSeconds: 3,
  maxWalkSeconds: 8,
  minRestSeconds: 5,
  maxRestSeconds: 12,
  autoSit: true,
  autoSleep: true,
  sleepTimeoutSeconds: 180,
  randomWave: true,
  behaviorFrequency: 2,
  idleSitSeconds: 60,
  interactionBubbles: true,
};

const BOOLEAN_KEYS = [
  'showPet', 'alwaysOnTop', 'launchAtLogin', 'autoStartRoaming',
  'showMenuBarIcon', 'showDockIcon', 'allowClickHeart', 'allowAutonomousRoaming',
  'autoSit', 'autoSleep', 'randomWave', 'interactionBubbles',
] as const;
const NUMBER_RANGES = {
  petScalePercent: [60, 150],
  roamingSpeedDipPerSecond: [10, 120],
  minWalkSeconds: [1, 60],
  maxWalkSeconds: [1, 60],
  minRestSeconds: [1, 120],
  maxRestSeconds: [1, 120],
  idleSitSeconds: [15, 600],
  sleepTimeoutSeconds: [30, 1800],
  behaviorFrequency: [1, 3],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(max, Math.max(min, value)));
}

/** Merge persisted values with defaults and migrate older/partial settings files. */
export function normalizeAppSettings(value: unknown): AppSettings {
  const source = isRecord(value) ? value : {};
  if (typeof source.schemaVersion === 'number' && source.schemaVersion > SETTINGS_SCHEMA_VERSION) {
    return { ...DEFAULT_APP_SETTINGS };
  }

  const settings = { ...DEFAULT_APP_SETTINGS };
  for (const key of BOOLEAN_KEYS) {
    if (typeof source[key] === 'boolean') settings[key] = source[key] as never;
  }
  for (const [key, [min, max]] of Object.entries(NUMBER_RANGES) as [keyof typeof NUMBER_RANGES, readonly [number, number]][]) {
    settings[key] = normalizeNumber(source[key], DEFAULT_APP_SETTINGS[key], min, max) as never;
  }
  settings.schemaVersion = SETTINGS_SCHEMA_VERSION;
  if (settings.minWalkSeconds > settings.maxWalkSeconds) {
    [settings.minWalkSeconds, settings.maxWalkSeconds] = [settings.maxWalkSeconds, settings.minWalkSeconds];
  }
  if (settings.minRestSeconds > settings.maxRestSeconds) {
    [settings.minRestSeconds, settings.maxRestSeconds] = [settings.maxRestSeconds, settings.minRestSeconds];
  }
  // Keep at least one reliable way to reopen the app after closing its windows.
  if (!settings.showDockIcon && !settings.showMenuBarIcon) settings.showMenuBarIcon = true;
  return settings;
}

export function validateSettingsPatch(value: unknown): value is AppSettingsPatch {
  if (!isRecord(value) || Object.keys(value).length === 0 || 'schemaVersion' in value) return false;
  const allowedKeys = new Set([...BOOLEAN_KEYS, ...Object.keys(NUMBER_RANGES)]);
  for (const [key, entry] of Object.entries(value)) {
    if (!allowedKeys.has(key)) return false;
    if ((BOOLEAN_KEYS as readonly string[]).includes(key)) {
      if (typeof entry !== 'boolean') return false;
    } else {
      const [min, max] = NUMBER_RANGES[key as keyof typeof NUMBER_RANGES];
      if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < min || entry > max) return false;
    }
  }
  return true;
}
