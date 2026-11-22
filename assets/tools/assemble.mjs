/**
 * Compile Check + Boxes + shell, stage out/, then sync assets links.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsRoot = path.resolve(__dirname, '..');
const monoRoot = path.resolve(assetsRoot, '..');
const streamRoot = path.join(monoRoot, 'agents-stream');
const checkRoot = path.join(monoRoot, 'agents-check');
const boxesRoot = path.join(monoRoot, 'agents-boxes');

function run(cwd, command, args) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const exe = command === 'npm' ? npmCmd : command;
  console.log(`[assemble] ${cwd}: ${exe} ${args.join(' ')}`);
  const result = spawnSync(exe, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true });
}

function main() {
  if (!fs.existsSync(checkRoot) || !fs.existsSync(boxesRoot)) {
    console.error('[assemble] agents-check / agents-boxes not found next to agents-stream');
    process.exit(1);
  }

  run(checkRoot, 'npm', ['run', 'compile']);
  run(boxesRoot, 'npm', ['run', 'compile']);
  run(streamRoot, 'npm', ['run', 'compile:shell']);

  const outDir = path.join(streamRoot, 'out');
  const checkOut = path.join(outDir, 'check');
  const boxesOut = path.join(outDir, 'boxes');
  rmrf(checkOut);
  rmrf(boxesOut);
  copyDir(path.join(checkRoot, 'out'), checkOut);
  copyDir(path.join(boxesRoot, 'out'), boxesOut);

  run(monoRoot, 'node', [path.join(__dirname, 'sync-assets.mjs')]);

  console.log('[assemble] staged out/check, out/boxes; assets/ linked');
}

main();
