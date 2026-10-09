/**
 * pathkit.js — 跨机器自适应的路径 / 运行时依赖解析（发布类 skill 的公共依赖）
 *
 * 设计原则：**不写死任何用户名、盘符、Node 版本号、node_modules 位置**。
 *   一切从 os.homedir() / 环境变量 / 运行时探测推导，环境变量始终可覆盖。
 *
 * 用法（用相对路径引用，两种目录布局都能解析）：
 *   const pk = require('../../isolated-browser/scripts/pathkit.js');
 *   const { chromium } = pk.playwright();
 *
 * 布局说明：
 *   布局 A（仓库源）：   D:\skills\<skill>\scripts\...
 *   布局 B（接入加载）： ~/.workbuddy/skills\<skill>\scripts\...  (junction → D:\skills\<skill>)
 *   两种布局下 `../../isolated-browser/scripts/pathkit.js` 都指向本文件。
 *
 * 环境变量（都可选，用于覆盖探测结果）：
 *   WORKBUDDY_HOME         WorkBuddy 用户目录（默认 ~/.workbuddy）
 *   OPENCLAW_NODE_MODULES  含 playwright-core 的 node_modules 目录
 *   QCLAW_HOME             OpenClaw 安装根目录（默认自动扫描各盘符下的 qclaw）
 *   QCLAW_CLI_OPENCLAW_MJS OpenClaw 自身 openclaw.mjs 路径（从中反推 node_modules）
 *   PUBLISH_IMAGE_DIR      配图目录（默认自动找 skills 根旁的 car 目录）
 *   ISOB_CDP_PORT          CDP 端口（默认 9222）
 *   ISOB_PROFILE_DIR       Chrome 隔离 profile 目录
 *   AGENT_BROWSER_EXECUTABLE_PATH / CHROME_PATH  Chrome 可执行文件
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------- 基础位置

const HOME = os.homedir();
const WORKBUDDY_HOME = process.env.WORKBUDDY_HOME || path.join(HOME, '.workbuddy');

// 本文件位于 <skillsRoot>/isolated-browser/scripts/pathkit.js
// → SKILLS_ROOT = D:\skills 或 ~/.workbuddy/skills
const ISOB_SCRIPTS_DIR = __dirname;
const ISOB_SKILL_DIR = path.resolve(__dirname, '..');
const SKILLS_ROOT = path.resolve(__dirname, '..', '..');

function exists(p) {
  try { return !!p && fs.existsSync(p); } catch (_) { return false; }
}

function isDir(p) {
  try { return !!p && fs.statSync(p).isDirectory(); } catch (_) { return false; }
}

/** 版本号降序比较（取最新） */
function cmpVersionDesc(a, b) {
  const pa = String(a).split(/[.\-]/).map(n => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.\-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return d;
  }
  return 0;
}

function listDir(p) {
  try { return fs.readdirSync(p); } catch (_) { return []; }
}

// ---------------------------------------------------------------- node / node_modules

/** 候选 node_modules 目录（按优先级，去重后逐个存在性检查） */
function nodeModulesCandidates() {
  const c = [];
  if (process.env.OPENCLAW_NODE_MODULES) c.push(process.env.OPENCLAW_NODE_MODULES);

  // WorkBuddy 托管 node 的 workspace（本机可能没有，存在才用）
  c.push(path.join(WORKBUDDY_HOME, 'binaries', 'node', 'workspace', 'node_modules'));

  // WorkBuddy 托管 node 各版本自带的 global node_modules
  for (const v of listDir(path.join(WORKBUDDY_HOME, 'binaries', 'node', 'versions'))) {
    c.push(path.join(WORKBUDDY_HOME, 'binaries', 'node', 'versions', v, 'lib', 'node_modules'));
    c.push(path.join(WORKBUDDY_HOME, 'binaries', 'node', 'versions', v, 'node_modules'));
  }

  // OpenClaw（qclaw）安装目录：从 openclaw.mjs 反推
  if (process.env.QCLAW_CLI_OPENCLAW_MJS) {
    c.push(path.join(process.env.QCLAW_CLI_OPENCLAW_MJS.replace(/[\\/]openclaw[\\/]openclaw\.mjs$/, ''), 'node_modules'));
  }

  // OpenClaw 安装根目录（env 指定 → 否则扫描各盘符）
  const qclawRoots = [];
  if (process.env.QCLAW_HOME) qclawRoots.push(process.env.QCLAW_HOME);
  for (const drive of ['C', 'D', 'E', 'F', 'G', 'H']) {
    qclawRoots.push(`${drive}:/qclaw`);
  }
  for (const root of qclawRoots) {
    // 版本目录可能带 v 前缀（如 v0.2.33.617），也可能不带
    const vers = listDir(root).filter(v => /^v?\d+\.\d+\.\d+/.test(v)).sort(cmpVersionDesc);
    for (const v of vers) {
      c.push(path.join(root, v, 'resources', 'openclaw', 'node_modules'));
    }
    // 非版本化布局兜底
    c.push(path.join(root, 'resources', 'openclaw', 'node_modules'));
  }

  // 本 skill 自带的 node_modules（有的 skill 用 package.json 自装依赖，如 ws）
  c.push(path.join(ISOB_SKILL_DIR, 'node_modules'));

  const seen = new Set();
  return c.filter(p => {
    const k = path.resolve(p).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 返回第一个「真实存在且含 playwright-core/package.json」的 node_modules 目录，找不到返回 null */
function resolveNodeModules() {
  for (const c of nodeModulesCandidates()) {
    if (exists(path.join(c, 'playwright-core', 'package.json'))) return c;
  }
  return null;
}

let _playwright = null;

/**
 * 解析并返回 playwright-core 模块。
 * 顺序：OPENCLAW_NODE_MODULES / 各候选 node_modules → 裸 require（依赖 NODE_PATH 或就近 node_modules）。
 * 全部失败时抛出带排查指引的错误。
 */
function resolvePlaywright() {
  if (_playwright) return _playwright;

  const nm = resolveNodeModules();
  if (nm) {
    _playwright = require(path.join(nm, 'playwright-core'));
    return _playwright;
  }

  // 最后兜底：交给 Node 自身的解析（NODE_PATH / 就近 node_modules / 全局）
  try {
    _playwright = require('playwright-core');
    return _playwright;
  } catch (e) {
    const tried = nodeModulesCandidates().map(p => '  - ' + p).join('\n');
    throw new Error(
      '未找到 playwright-core。已尝试以下 node_modules 目录：\n' + tried + '\n' +
      '请任选其一：\n' +
      '  a) 设置环境变量 OPENCLAW_NODE_MODULES 指向含 playwright-core 的 node_modules；\n' +
      '  b) 在含 playwright-core 的目录下用 NODE_PATH 启动 node；\n' +
      '  c) 安装：node "' + path.join(WORKBUDDY_HOME, 'binaries', 'node', 'workspace') + '" 下 npm i playwright-core'
    );
  }
}

/** require('playwright-core') 的命名友好别名 */
function playwright() { return resolvePlaywright(); }

/** 直接拿到 { chromium } 解构用法 */
function chromium() { return resolvePlaywright().chromium; }

// ---------------------------------------------------------------- node 可执行文件

/** 托管 node 可执行文件（取最新版本；env NODE_EXE 可覆盖） */
function nodeExe() {
  if (process.env.NODE_EXE) return process.env.NODE_EXE;

  const versionsDir = path.join(WORKBUDDY_HOME, 'binaries', 'node', 'versions');
  const vers = listDir(versionsDir).filter(v => isDir(path.join(versionsDir, v))).sort(cmpVersionDesc);
  for (const v of vers) {
    const cands = [
      path.join(versionsDir, v, 'node.exe'),
      path.join(versionsDir, v, 'bin', 'node'),
    ];
    for (const c of cands) if (exists(c)) return c;
  }
  // current 软链兜底
  const cur = path.join(versionsDir, 'current', 'node.exe');
  if (exists(cur)) return cur;

  return process.execPath || 'node'; // 当前进程的 node 最稳
}

/** 托管 node 版本目录（形如 <ver>），找不到返回 null */
function nodeVersionDir() {
  const exe = nodeExe();
  if (exe && /[\\/]versions[\\/]/.test(exe)) return path.dirname(exe.replace(/[\\/]bin[\\/]node$/, ''));
  return null;
}

/** 返回可直接拼进命令行的 node 可执行文件（正斜杠风格，供 git-bash 使用） */
function nodeExePosix() { return nodeExe().replace(/\\/g, '/'); }

// ---------------------------------------------------------------- Chrome / CDP

function findChrome() {
  const cands = [
    process.env.AGENT_BROWSER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    path.join(HOME, 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean);
  for (const c of cands) if (exists(c)) return c;
  return 'chrome';
}

function cdpPort(fallback) {
  return process.env.ISOB_CDP_PORT || fallback || 9222;
}

/** 隔离 Chrome 的 profile 目录（默认 ~/.chrome_qclaw_stable，env 可覆盖） */
function profileDir(name) {
  if (process.env.ISOB_PROFILE_DIR) return process.env.ISOB_PROFILE_DIR;
  return path.join(HOME, name || '.chrome_qclaw_stable');
}

/** isolated-browser 的 launch.js 绝对路径（正斜杠） */
function isobLaunch() {
  return path.join(ISOB_SCRIPTS_DIR, 'launch.js').replace(/\\/g, '/');
}

// ---------------------------------------------------------------- 配图目录

/**
 * 默认配图目录（如 <素材目录>）。
 * 顺序：PUBLISH_IMAGE_DIR → skills 根旁的 car → ~/car → cwd/car
 */
function imageDir() {
  if (process.env.PUBLISH_IMAGE_DIR) return process.env.PUBLISH_IMAGE_DIR;
  const cands = [
    path.join(SKILLS_ROOT, 'car'),
    path.join(HOME, 'car'),
    path.join(process.cwd(), 'car'),
  ];
  for (const c of cands) if (isDir(c)) return c;
  return cands[0];
}

// ---------------------------------------------------------------- 汇总信息

/** 便于排查的运行时快照 */
function info() {
  return {
    HOME,
    WORKBUDDY_HOME,
    SKILLS_ROOT,
    nodeExe: nodeExe(),
    nodeVersion: (function () {
      try {
        return require('child_process').execFileSync(nodeExe(), ['-v'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      } catch (_) { return process.version || null; }
    })(),
    nodeModules: resolveNodeModules(),
    chrome: findChrome(),
    cdpPort: String(cdpPort()),
    isobLaunch: isobLaunch(),
    imageDir: imageDir(),
  };
}

module.exports = {
  HOME,
  WORKBUDDY_HOME,
  SKILLS_ROOT,
  ISOB_SKILL_DIR,
  ISOB_SCRIPTS_DIR,
  exists,
  isDir,
  listDir,
  cmpVersionDesc,
  nodeModulesCandidates,
  resolveNodeModules,
  resolvePlaywright,
  playwright,
  chromium,
  nodeExe,
  nodeExePosix,
  nodeVersionDir,
  findChrome,
  cdpPort,
  profileDir,
  isobLaunch,
  imageDir,
  info,
};

// 直接执行时打印环境快照：node pathkit.js --info
if (require.main === module) {
  console.log(JSON.stringify(info(), null, 2));
}
