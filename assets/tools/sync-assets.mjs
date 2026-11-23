/**
 * Link each package assets/ directory to repo-root assets/, and copy LICENSE.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsRoot = path.resolve(__dirname, '..');
const monoRoot = path.resolve(assetsRoot, '..');

const PACKAGES = ['agents-check', 'agents-boxes', 'agents-stream'];

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function ensureHardLink(linkPath, targetAbs) {
  if (!fs.existsSync(targetAbs)) {
    throw new Error(`[sync-assets] missing target: ${targetAbs}`);
  }

  let alreadyLinked = false;
  try {
    const linkStat = fs.statSync(linkPath);
    const targetStat = fs.statSync(targetAbs);
    alreadyLinked =
      linkStat.dev === targetStat.dev &&
      linkStat.ino === targetStat.ino &&
      linkStat.size === targetStat.size;
  } catch {
    alreadyLinked = false;
  }

  if (alreadyLinked) {
    return;
  }

  fs.rmSync(linkPath, { force: true });
  fs.linkSync(targetAbs, linkPath);
}

function ensureLink(linkPath, targetAbs) {
  if (!fs.existsSync(targetAbs)) {
    throw new Error(`[sync-assets] missing target: ${targetAbs}`);
  }

  let alreadyOk = false;
  try {
    const st = fs.lstatSync(linkPath);
    if (st.isSymbolicLink()) {
      const resolved = fs.realpathSync(linkPath);
      alreadyOk = path.resolve(resolved) === path.resolve(targetAbs);
    }
  } catch {
    alreadyOk = false;
  }

  if (alreadyOk) {
    return;
  }

  rmrf(linkPath);
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });

  const type = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(targetAbs, linkPath, type);
}

function main() {
  if (!fs.existsSync(assetsRoot)) {
    console.error('[sync-assets] missing assets/ at monorepo root');
    process.exit(1);
  }

  const licenseSrc = path.join(monoRoot, 'LICENSE');
  if (!fs.existsSync(licenseSrc)) {
    console.error('[sync-assets] missing LICENSE at monorepo root');
    process.exit(1);
  }

  for (const pkg of PACKAGES) {
    const pkgRoot = path.join(monoRoot, pkg);
    if (!fs.existsSync(pkgRoot)) {
      console.warn(`[sync-assets] skip missing package: ${pkg}`);
      continue;
    }
    ensureLink(path.join(pkgRoot, 'assets'), assetsRoot);
    fs.copyFileSync(licenseSrc, path.join(pkgRoot, 'LICENSE'));
  }

  ensureHardLink(
    path.join(monoRoot, 'agents-stream', 'README.md'),
    path.join(monoRoot, 'README.md'),
  );

  console.log('[sync-assets] linked assets/ → repo assets/; README hardlinked; LICENSE copied');
}

main();
