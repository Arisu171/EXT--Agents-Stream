/**
 * Package agents-stream into repo-root build/*.vsix.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monoRoot = path.resolve(__dirname, '../..');
const streamRoot = path.join(monoRoot, 'agents-stream');
const buildDir = path.join(monoRoot, 'build');

const pkg = JSON.parse(fs.readFileSync(path.join(streamRoot, 'package.json'), 'utf8'));
const outFile = path.join(buildDir, `${pkg.name}-${pkg.version}.vsix`);

fs.mkdirSync(buildDir, { recursive: true });

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = [
  '--yes',
  '@vscode/vsce',
  'package',
  '--allow-missing-repository',
  '--follow-symlinks',
  '--out',
  outFile,
];

console.log(`[package] ${streamRoot}: ${npxCmd} ${args.join(' ')}`);
const result = spawnSync(npxCmd, args, {
  cwd: streamRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`[package] wrote ${outFile}`);
