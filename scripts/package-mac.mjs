import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

if (process.platform !== 'darwin') throw new Error('macOS packaging must run on macOS.');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a semantic application version.');
const output = join(root, 'release', `v${version}`);
const app = join(output, 'mac-arm64', 'Pixel Pet.app');
const staging = join(output, 'dmg-staging');
const dmg = join(root, 'release', `PixelPet-${version}-arm64.dmg`);

const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (name.startsWith('CSC_') || name.startsWith('APPLE_')) delete env[name];
}
env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
env.ELECTRON_MIRROR ??= 'https://npmmirror.com/mirrors/electron/';

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Keep older versions, including their .app outputs, untouched.
rmSync(app, { recursive: true, force: true });
rmSync(staging, { recursive: true, force: true });
run(join(root, 'node_modules', '.bin', 'electron-builder'), ['--mac', 'dir', '--arm64', `--config.directories.output=${output}`]);
mkdirSync(staging, { recursive: true });
run('ditto', [app, join(staging, 'Pixel Pet.app')]);
symlinkSync('/Applications', join(staging, 'Applications'));
if (existsSync(dmg)) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  renameSync(dmg, dmg.replace(/\.dmg$/, `-${timestamp}.dmg`));
}
run('hdiutil', ['create', '-volname', 'PixelPet', '-srcfolder', staging, '-format', 'UDZO', dmg]);
const helper = join(root, 'release', 'Allow-PixelPet.command');
copyFileSync(join(root, 'scripts', 'Allow-PixelPet.command'), helper);
chmodSync(helper, 0o755);
console.log(`Created unsigned, non-notarized test build: ${dmg}`);
