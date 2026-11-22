
import * as path from 'path';
import * as vscode from 'vscode';
import ignore, { Ignore } from 'ignore';
import { splitByWorkspaceFolder } from './pathExclusions';

type FileDetectionMode = 'defaultAndCustom' | 'customOnly';

interface TextFileRules {
  extensions: ReadonlySet<string>;
  filenames: ReadonlySet<string>;
  filenamePatterns: readonly RegExp[];
  included: Ignore | undefined;
}

const DEFAULT_TEXT_EXTS = new Set([
  '.agent.md', '.astro', '.ascx', '.asp', '.aspx', '.atom', '.axaml', '.axml',
  '.bash', '.bash_aliases', '.bash_login', '.bash_logout', '.bash_profile', '.bashrc',
  '.bat', '.bbx', '.bib', '.bpmn', '.brs',
  '.c', '.c++', '.c++m', '.cake', '.cbx', '.cc', '.ccm', '.cfg', '.cginc',
  '.chatmode.md', '.cjs', '.clj', '.cljc', '.cljs', '.cljx', '.clojure',
  '.cmake', '.cmd', '.code-profile', '.code-search', '.code-snippets',
  '.code-workspace', '.coffee', '.conf', '.containerfile', '.copilotmd',
  '.cpp', '.cppm', '.cs', '.csh', '.cshrc', '.cshtml', '.cson', '.css',
  '.css.map', '.csx', '.cts', '.cu', '.cuh', '.cxx', '.cxxm',
  '.dart', '.diff', '.directory', '.dita', '.ditamap', '.dsql', '.dtd', '.dtml',
  '.ebuild', '.eclass', '.edn', '.ejs', '.ent', '.erb', '.es6', '.eslintrc',
  '.eslintrc.json', '.eyaml', '.eyml',
  '.fish', '.fs', '.fsi', '.fsproj', '.fsscript', '.fsx', '.fxml', '.fx', '.fxh',
  '.geojson', '.git-blame-ignore-revs', '.gitattributes', '.gitconfig',
  '.gitignore', '.gitignore_global', '.gitmodules', '.go', '.gradle', '.gradle.kts',
  '.groovy', '.gvy', '.gyp', '.gypi',
  '.h', '.h++', '.h.in', '.handlebars', '.har', '.hbs', '.hh', '.hintrc',
  '.hjs',
  '.hlsl', '.hlsli', '.hpp', '.hpp.in', '.htm', '.html', '.hxx',
  '.i', '.iced', '.iml', '.ini', '.ino', '.inl', '.instructions.md', '.ipy',
  '.ipp', '.ipynb', '.isml', '.ixx',
  '.j2', '.jade', '.java', '.jav', '.jl', '.jmd', '.jenkinsfile', '.jinja2',
  '.jmx', '.js', '.js.map', '.jsfmtrc', '.jshintrc', '.jshtm', '.jslintrc',
  '.json', '.jsonc', '.jsonl', '.jsonld', '.jsp', '.jsx',
  '.ksh',
  '.launch', '.less', '.litcoffee', '.log', '.ltx', '.lua',
  '.m', '.mak', '.markdown', '.markdn', '.md', '.mdoc', '.mdown', '.mdtext',
  '.mdtxt', '.mk', '.mkd', '.mkdn', '.mjs', '.mm', '.mod', '.mts', '.mxml',
  '.ndjson', '.nf', '.nqp', '.npmignore', '.npmrc', '.nuspec',
  '.opml', '.owl',
  '.p6', '.pac', '.patch', '.php', '.php4', '.php5', '.phtml', '.pl', '.pl6',
  '.pm', '.pm6', '.pod', '.podspec', '.profile', '.proj', '.prompt.md',
  '.properties', '.props', '.ps1', '.psd1', '.psgi', '.psh', '.psm1',
  '.psrc', '.pssc', '.pt', '.pubxml', '.pubxml.user', '.publishsettings',
  '.pug', '.py', '.pyi', '.pyt', '.pyw',
  '.r', '.rake', '.raku', '.rakudoc', '.rakumod', '.rakutest', '.razor',
  '.rb', '.rbi', '.rbx', '.rbxlx', '.rbxmx', '.rdf', '.rej', '.repo',
  '.rhtml', '.rjs', '.rng', '.ron', '.ronn', '.rprofile', '.rpy', '.rs', '.rst',
  '.rt', '.ru',
  '.sass', '.scss', '.shader', '.sh', '.shproj', '.shtml', '.slnx', '.sql',
  '.storyboard', '.sty', '.svg', '.svelte', '.swift', '.swcrc',
  '.t', '.targets', '.tcshrc', '.tex', '.tld', '.tmx', '.toml', '.tpp', '.ts',
  '.ts.map', '.tsbuildinfo', '.tsx', '.txx', '.txt',
  '.vba', '.vb', '.vbs', '.vbproj', '.vbproj.user', '.vcxproj',
  '.vcxproj.filters', '.volt', '.vue',
  '.wat', '.webmanifest', '.winget', '.workbook', '.wsdl', '.wxi', '.wxl',
  '.wxs',
  '.xaml', '.xbl', '.xht', '.xhtml', '.xib', '.xlf', '.xliff', '.xml',
  '.xoml', '.xpdl', '.xprofile', '.xsession', '.xsessionrc', '.xsl', '.xslt',
  '.xsd', '.xul',
  '.yaml', '.yaml-tmlanguage', '.yaml-tmpreferences', '.yaml-tmtheme',
  '.yash_profile', '.yashrc', '.yml',
  '.zlogin', '.zlogout', '.zprofile', '.zsh', '.zsh-theme', '.zshenv', '.zshrc',
]);

const DEFAULT_TEXT_FILENAMES = new Set([
  '.babelrc', '.condarc', '.containerignore', '.devcontainer-internal.json',
  '.dockerignore', '.editorconfig', '.env', '.envrc', '.flake8', '.flaskenv',
  '.git-blame-ignore-revs', '.gitattributes', '.gitconfig', '.gitignore',
  '.gitignore_global', '.gitmodules', '.hushlogin', '.jscsrc', '.jshintrc',
  '.npmignore', '.npmrc', '.pep8', '.pylintrc', '.pypirc', '.vuerc',
  'apkbuild', 'cmakecache.txt', 'cmakelists.txt', 'containerfile',
  'constraints.txt', 'devcontainer-feature.json', 'dockerfile', 'gnumakefile',
  'jenkinsfile', 'makefile', 'ocamlmakefile', 'pipfile', 'pipfile.lock',
  'pkgbuild', 'poetry.lock', 'requirements.in', 'requirements.txt', 'uv.lock',
  'user-dirs.dirs',
]);

const DEFAULT_TEXT_FILENAME_PATTERNS = [
  /^.*\.containerfile$/i,
  /^.*\.dockerignore$/i,
  /^.*\.dockerfile$/i,
  /^.*constraints.*\.txt$/i,
  /^.*requirements.*\.(txt|in)$/i,
  /^containerfile\..*$/i,
  /^dockerfile\..*$/i,
  /^jenkinsfile.*$/i,
  /^.*\.env\..*$/i,
  /^.*\.log\..*$/i,
];

let textFileRules: TextFileRules | undefined;

export function isTextFile(absPath: string): boolean {
  if (!textFileRules) {
    refreshTextFileRules();
  }
  const rules = textFileRules!;
  if (rules.included) {
    const rel = splitByWorkspaceFolder(absPath)?.relParts.join('/') ?? path.basename(absPath);
    const result = rules.included.test(rel);
    if (result.unignored) { return false; }
    if (result.ignored) { return true; }
  }
  const lowerName = path.basename(absPath).toLowerCase();
  if (rules.filenames.has(lowerName)) { return true; }
  if (rules.filenamePatterns.some(pattern => pattern.test(lowerName))) { return true; }
  return Array.from(rules.extensions).some(ext => lowerName.endsWith(ext));
}

export function looksBinary(content: string): boolean {
  return content.slice(0, 8192).includes('\0');
}

export function refreshTextFileRules(): void {
  const config = vscode.workspace.getConfiguration('agents-check');
  const mode = config.get<FileDetectionMode>('supportedFileDetectionMode', 'defaultAndCustom');
  const patterns = [
    ...stringList(config.get<unknown>('includedPaths', [])),
    ...legacyIncludePatterns(config),
  ];

  let included: Ignore | undefined;
  if (patterns.length > 0) {
    try {
      included = ignore({ ignorecase: process.platform !== 'linux' }).add(patterns);
    } catch (err) {
      console.warn('[agents-check] invalid includedPaths entry, user inclusions disabled:', err);
    }
  }

  const builtIn = mode !== 'customOnly';
  textFileRules = {
    extensions: builtIn ? DEFAULT_TEXT_EXTS : new Set(),
    filenames: builtIn ? DEFAULT_TEXT_FILENAMES : new Set(),
    filenamePatterns: builtIn ? DEFAULT_TEXT_FILENAME_PATTERNS : [],
    included,
  };
}

const LEGACY_KEYS = ['supportedFileExtensions', 'supportedFilenames', 'supportedFilenamePatterns'] as const;
type LegacyKey = typeof LEGACY_KEYS[number];

function legacyToPattern(key: LegacyKey, value: string): string {
  const v = value.trim();
  if (key === 'supportedFileExtensions') {
    return `*${v.startsWith('.') ? v : `.${v}`}`;
  }
  const escaped = key === 'supportedFilenames' ? v.replace(/[*?[\\]/g, '\\$&') : v.replace(/\[/g, '\\[');
  return /^[#!]/.test(escaped) ? `\\${escaped}` : escaped;
}

function legacyIncludePatterns(config: vscode.WorkspaceConfiguration): string[] {
  return LEGACY_KEYS.flatMap((key) =>
    stringList(config.get<unknown>(key, [])).map((v) => legacyToPattern(key, v)));
}

export async function migrateLegacyTextFileSettings(): Promise<void> {
  const config = vscode.workspace.getConfiguration('agents-check');
  const migrated: string[] = [];
  const toClear: LegacyKey[] = [];
  for (const key of LEGACY_KEYS) {
    const values = stringList(config.inspect<unknown>(key)?.globalValue);
    if (config.inspect<unknown>(key)?.globalValue === undefined) { continue; }
    toClear.push(key);
    migrated.push(...values.map((v) => legacyToPattern(key, v)));
  }
  if (toClear.length === 0) { return; }

  const current = stringList(config.inspect<unknown>('includedPaths')?.globalValue);
  const next = [...current];
  for (const p of migrated) {
    if (!next.includes(p)) { next.push(p); }
  }
  try {
    if (next.length !== current.length) {
      await config.update('includedPaths', next, vscode.ConfigurationTarget.Global);
    }
    for (const key of toClear) {
      await config.update(key, undefined, vscode.ConfigurationTarget.Global);
    }
  } catch (err) {
    console.warn('[agents-check] migrating legacy text file settings failed:', err);
  }
}

function stringList(values: unknown): string[] {
  if (!Array.isArray(values)) { return []; }
  return values.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
}
