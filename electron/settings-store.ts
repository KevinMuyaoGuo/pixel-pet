import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_APP_SETTINGS, normalizeAppSettings, type AppSettings, type AppSettingsPatch } from './settings-types.js';

export class SettingsStore {
  private current: AppSettings;

  constructor(private readonly filePath: string) {
    this.current = this.read();
  }

  get value() { return { ...this.current }; }

  update(patch: AppSettingsPatch) {
    this.current = normalizeAppSettings({ ...this.current, ...patch });
    this.write();
    return this.value;
  }

  reset() {
    this.current = { ...DEFAULT_APP_SETTINGS };
    this.write();
    return this.value;
  }

  private read(): AppSettings {
    try {
      if (!existsSync(this.filePath)) return { ...DEFAULT_APP_SETTINGS };
      return normalizeAppSettings(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch (error) {
      console.warn('Could not read settings; using defaults:', error);
      return { ...DEFAULT_APP_SETTINGS };
    }
  }

  private write() {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, `${JSON.stringify(this.current, null, 2)}\n`, 'utf8');
    } catch (error) {
      console.error('Could not save settings:', error);
    }
  }
}
