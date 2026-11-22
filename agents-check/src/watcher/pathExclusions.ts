import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import ignore from 'ignore';

const EXCLUDED_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  'out',
  'dist',
  'build',
  '.vscode',
  '.idea',
  '.claude',
  'bin',
  'obj',
  'TestResults',
  'artifacts',
  '.vs',
  'target',
  '.gradle',
  '.settings',
  '.classpath',
  '.project',
  'venv',
  '.venv',
  'env',
  '.env',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  'site-packages',
  'dist-info',
  'egg-info',
]);

const nugetPackagesCache = new Map<string, boolean>();

function isNugetPackagesParent(parentDir: string): boolean {
  const cached = nugetPackagesCache.get(parentDir);
  if (cached !== undefined) { return cached; }
  let result = false;
  try {
    for (const entry of fs.readdirSync(parentDir)) {
      if (entry.toLowerCase().endsWith('.sln')) { result = true; break; }
    }
  } catch {
    result = false;
  }
  nugetPackagesCache.set(parentDir, result);
  return result;
}

let userRules: ignore.Ignore | undefined;
let userRulesLoaded = false;
let respectGitignore = true;

const dirRulesCache = new Map<string, ignore.Ignore | null>();
const repoRootCache = new Map<string, boolean>();
const gitBaseCache = new Map<string, string>();

export function clearGitignoreCache(): void {
  dirRulesCache.clear();
  repoRootCache.clear();
  gitBaseCache.clear();
}

export function refreshPathExclusions(): void {
  const config = vscode.workspace.getConfiguration('agents-check');
  const entries = config.get<unknown>('excludedPaths', []);
  const patterns = Array.isArray(entries)
    ? entries.filter((e): e is string => typeof e === 'string' && e.trim() !== '').map(e => e.trim())
    : [];

  respectGitignore = config.get<boolean>('respectGitignore', true) !== false;
  clearGitignoreCache();

  userRules = undefined;
  userRulesLoaded = true;
  if (patterns.length === 0) { return; }
  try {
    userRules = ignore({ ignorecase: process.platform !== 'linux' }).add(patterns);
  } catch (err) {
    console.warn('[agents-check] invalid excludedPaths entry, user exclusions disabled:', err);
  }
}

function rules(): ignore.Ignore | undefined {
  if (!userRulesLoaded) { refreshPathExclusions(); }
  return userRules;
}

export function splitByWorkspaceFolder(absPath: string): { root: string; relParts: string[] } | undefined {
  let best: { root: string; relParts: string[] } | undefined;
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const root = folder.uri.fsPath;
    const rel = path.relative(root, absPath);
    if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) { continue; }
    const relParts = rel.split(path.sep);
    if (!best || relParts.length < best.relParts.length) {
      best = { root, relParts };
    }
  }
  return best;
}

function hasExcludedSegment(baseDir: string, parts: string[]): boolean {
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (EXCLUDED_SEGMENTS.has(p)) { return true; }
    if (p === 'packages') {
      const parentDir = path.join(baseDir, ...parts.slice(0, i));
      if (isNugetPackagesParent(parentDir)) { return true; }
    }
  }
  return false;
}

export function isExcludedPathSegment(absPath: string): boolean {
  const inWorkspace = splitByWorkspaceFolder(absPath);
  if (!inWorkspace) {
    const parts = absPath.split(path.sep);
    return hasExcludedSegment(parts[0] + path.sep, parts.slice(1));
  }

  const { root, relParts } = inWorkspace;
  if (hasExcludedSegment(root, relParts)) { return true; }

  const userIgnore = rules();
  if (userIgnore !== undefined && userIgnore.ignores(relParts.join('/'))) { return true; }

  return respectGitignore && isGitIgnored(root, relParts);
}

function cacheKey(dir: string): string {
  return process.platform === 'win32' ? dir.toLowerCase() : dir;
}

function isRepoRoot(dir: string): boolean {
  const key = cacheKey(dir);
  let result = repoRootCache.get(key);
  if (result === undefined) {
    result = fs.existsSync(path.join(dir, '.git'));
    repoRootCache.set(key, result);
  }
  return result;
}

function readIfExists(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function dirRules(dir: string): ignore.Ignore | null {
  const key = cacheKey(dir);
  const cached = dirRulesCache.get(key);
  if (cached !== undefined) { return cached; }
  const exclude = isRepoRoot(dir) ? readIfExists(path.join(dir, '.git', 'info', 'exclude')) : undefined;
  const gitignore = readIfExists(path.join(dir, '.gitignore'));
  let result: ignore.Ignore | null = null;
  if (exclude !== undefined || gitignore !== undefined) {
    try {
      result = ignore({ ignorecase: process.platform !== 'linux' })
        .add(exclude ?? '')
        .add(gitignore ?? '');
    } catch (err) {
      console.warn(`[agents-check] unreadable ignore rules in ${dir}:`, err);
    }
  }
  dirRulesCache.set(key, result);
  return result;
}

function gitBase(root: string): string {
  const key = cacheKey(root);
  const cached = gitBaseCache.get(key);
  if (cached !== undefined) { return cached; }
  let base = root;
  for (let dir = root; ; dir = path.dirname(dir)) {
    if (isRepoRoot(dir)) { base = dir; break; }
    if (path.dirname(dir) === dir) { break; }
  }
  gitBaseCache.set(key, base);
  return base;
}

function isGitIgnored(root: string, relParts: string[]): boolean {
  const base = gitBase(root);
  const parts = base === root
    ? relParts
    : [...path.relative(base, root).split(path.sep), ...relParts];
  let ignored = false;
  let dir = base;
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      dir = path.join(dir, parts[i - 1]);
      if (isRepoRoot(dir)) { ignored = false; }
    }
    const rules = dirRules(dir);
    if (!rules) { continue; }
    const result = rules.test(parts.slice(i).join('/'));
    if (result.ignored) {
      ignored = true;
    } else if (result.unignored) {
      ignored = false;
    }
  }
  return ignored;
}
