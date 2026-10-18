// Builds the folder the Windows installer (installer/sea-mail.iss) ships, with nothing else to install:
//
//   build/windows/sea-mail/node/node.exe        portable Node.js, the version pinned below
//   build/windows/sea-mail/app/                 dist/, package.json and production node_modules
//   build/windows/sea-mail/bin/sea-mail.cmd     runs app\dist\cli\index.js with that node
//
// Run on Windows x64 with Node 22: `node scripts/package-windows.mjs`. npm installs the native
// modules (@napi-rs/keyring, better-sqlite3) for the machine running it, so elsewhere the result does
// not work on Windows; --any-platform skips that check to try the script itself on another machine.
// In GitHub Actions it also sets the step outputs `version` and `layout`.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE_VERSION = '22.23.3';
/** From https://nodejs.org/dist/v22.23.3/SHASUMS256.txt */
const NODE_ZIP_SHA256 = '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71';
const NODE_DIST = `node-v${NODE_VERSION}-win-x64`;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILD = path.join(ROOT, 'build');
const LAYOUT = path.join(BUILD, 'windows', 'sea-mail');
const APP = path.join(LAYOUT, 'app');
const onWindows = process.platform === 'win32';

if (!(onWindows && process.arch === 'x64') && !process.argv.includes('--any-platform')) {
  fail(`Run this on Windows x64 (this is ${process.platform}-${process.arch}); see the comment at the top of the script.`);
}
const major = Number(process.versions.node.split('.')[0]);
if (major !== Number(NODE_VERSION.split('.')[0])) {
  fail(`Run this with Node ${NODE_VERSION.split('.')[0]}.x, the major version it bundles (${NODE_VERSION}).`);
}

const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

step('Building sea-mail');
npm(ROOT, 'ci', '--no-audit', '--no-fund');
fs.rmSync(path.join(ROOT, 'dist'), { recursive: true, force: true });
npm(ROOT, 'run', 'build');

step('Installing production dependencies');
fs.rmSync(LAYOUT, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });
fs.cpSync(path.join(ROOT, 'dist'), path.join(APP, 'dist'), { recursive: true });
for (const file of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(ROOT, file), path.join(APP, file));
npm(APP, 'ci', '--omit=dev', '--no-audit', '--no-fund');
fs.rmSync(path.join(APP, 'package-lock.json'));
// better-sqlite3 ships its C sources and a prebuilt binary for every platform; keep only ours.
const sqlite = path.join(APP, 'node_modules', 'better-sqlite3');
const binary = `${onWindows ? 'win32-x64' : `${process.platform}-${process.arch}`}.node`;
if (!fs.existsSync(path.join(sqlite, 'prebuilds', binary))) fail(`better-sqlite3 has no prebuilds/${binary}; check how it loads its binary`);
for (const dir of ['deps', 'src']) fs.rmSync(path.join(sqlite, dir), { recursive: true, force: true });
for (const file of fs.readdirSync(path.join(sqlite, 'prebuilds'))) {
  if (file !== binary) fs.rmSync(path.join(sqlite, 'prebuilds', file));
}

step(`Adding Node.js ${NODE_VERSION}`);
const zip = await downloadNode();
const unpacked = path.join(BUILD, 'cache', NODE_DIST);
fs.rmSync(unpacked, { recursive: true, force: true });
// bsdtar reads zip files; Windows ships it as System32\tar.exe, which a GNU tar on PATH could shadow.
const tar = onWindows ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
execFileSync(tar, ['-xf', zip, '-C', path.dirname(unpacked), `${NODE_DIST}/node.exe`, `${NODE_DIST}/LICENSE`], { stdio: 'inherit' });
fs.mkdirSync(path.join(LAYOUT, 'node'));
for (const file of ['node.exe', 'LICENSE']) fs.copyFileSync(path.join(unpacked, file), path.join(LAYOUT, 'node', file));

step('Writing bin\\sea-mail.cmd');
fs.mkdirSync(path.join(LAYOUT, 'bin'));
const cmd = [
  '@echo off',
  'rem Runs sea-mail with the Node.js bundled next to it.',
  'setlocal',
  // %%~fI turns bin\.. into a clean absolute path, which `sea-mail connect` writes into client configs.
  'for %%I in ("%~dp0..") do set "SEA_MAIL_ROOT=%%~fI"',
  '"%SEA_MAIL_ROOT%\\node\\node.exe" "%SEA_MAIL_ROOT%\\app\\dist\\cli\\index.js" %*',
  'exit /b %ERRORLEVEL%',
  '',
];
fs.writeFileSync(path.join(LAYOUT, 'bin', 'sea-mail.cmd'), cmd.join('\r\n'));

const megabytes = (folderSize(LAYOUT) / 1024 / 1024).toFixed(0);
step(`Done: sea-mail ${version} for Windows in ${LAYOUT} (${megabytes} MB)`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nlayout=${LAYOUT}\n`);

function npm(cwd, ...args) {
  // npm is npm.cmd on Windows, which Node only starts through a shell.
  execFileSync('npm', args, { cwd, stdio: 'inherit', shell: onWindows });
}

/** The pinned Node.js zip, from build/cache when an earlier run already downloaded it. */
async function downloadNode() {
  const file = path.join(BUILD, 'cache', `${NODE_DIST}.zip`);
  if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== NODE_ZIP_SHA256) {
    const url = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIST}.zip`;
    console.log(`Downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) fail(`Could not download ${url}: HTTP ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer());
    const actual = sha256(data);
    if (actual !== NODE_ZIP_SHA256) fail(`${url} has SHA-256 ${actual}, expected ${NODE_ZIP_SHA256}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  }
  return file;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function folderSize(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .reduce((total, entry) => total + fs.statSync(path.join(entry.parentPath, entry.name)).size, 0);
}

function step(message) {
  console.log(`\n== ${message}`);
}

function fail(message) {
  console.error(`package-windows: ${message}`);
  process.exit(1);
}
