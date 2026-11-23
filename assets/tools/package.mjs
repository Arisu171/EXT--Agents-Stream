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

const args = [
  'exec',
  '--yes',
  '--package',
  '@vscode/vsce',
  '--',
  'vsce',
  'package',
  '--allow-missing-repository',
  '--follow-symlinks',
  '--out',
  outFile,
];

const npmCli = process.env.npm_execpath;
let exe = process.execPath;
let spawnArgs = npmCli ? [npmCli, ...args] : args;
if (!npmCli) {
  const npxArgs = [
    '--yes',
    '@vscode/vsce',
    'package',
    '--allow-missing-repository',
    '--follow-symlinks',
    '--out',
    outFile,
  ];
  if (process.platform === 'win32') {
    exe = process.env.ComSpec || 'cmd.exe';
    spawnArgs = ['/d', '/s', '/c', `npx.cmd ${npxArgs.join(' ')}`];
  } else {
    exe = 'npx';
    spawnArgs = npxArgs;
  }
}

console.log(`[package] ${streamRoot}: ${exe} ${spawnArgs.join(' ')}`);
const result = spawnSync(exe, spawnArgs, {
  cwd: streamRoot,
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`[package] wrote ${outFile}`);
