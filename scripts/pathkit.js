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
 *   布局 A（旧仓库源）：   D:\skills\<skill>\scripts\...  （2026-10-16 起已废弃，整体迁走）
 *   布局 B（统一根，现行）： F:\workbuddy-space\article\<skill>\scripts\...
 *   布局 C（接入加载）：    ~/.workbuddy/skills\<skill>\scripts\...  (junction → F:\workbuddy-space\article\<skill>)
 *   三种布局下 `../../isolated-browser/scripts/pathkit.js` 都指向本文件。
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
const http = require('http');
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

  // ★ 发布依赖统一根（2026-10-16 起）：skills 根自带的 node_modules
  //   （playwright-core 随 skill 一起管理，整体可搬迁、可备份）
  c.push(path.join(SKILLS_ROOT, 'node_modules'));

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

// ------------------------------------------------------- CDP 连接（含两个必踩的坑）

/**
 * 坑 1：把回环地址加入 NO_PROXY。
 *
 * 沙箱 / 某些 CI 环境会注入 `http_proxy=http://127.0.0.1:<port>`。
 * playwright 请求 `http://127.0.0.1:9222/json/version` 时会走这个代理，
 * 拿回的 webSocketDebuggerUrl 被改写成代理端口（如 ws://127.0.0.1:9300/...），
 * 于是 connectOverCDP 永远连不上（表现为 30s 超时，日志里 ws 端口是代理端口）。
 *
 * 只补 NO_PROXY、不动 http_proxy —— 需要联网下载图片的脚本仍可走代理。
 */
function ensureNoProxy() {
  const add = ['127.0.0.1', 'localhost', '::1'];
  for (const key of ['NO_PROXY', 'no_proxy']) {
    const cur = String(process.env[key] || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const h of add) if (!cur.includes(h)) cur.push(h);
    process.env[key] = cur.join(',');
  }
}

/** 取回文本（node http 不读 http_proxy，用于本机 CDP HTTP 端点最稳） */
function httpText(url, timeout) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', c => { d += c; });
      res.on('end', () => resolve(d));
    });
    req.setTimeout(timeout || 5000, () => req.destroy(new Error('timeout ' + url)));
    req.on('error', reject);
  });
}

/** 列出 CDP 当前所有 target（/json/list） */
async function cdpList(port) {
  const txt = await httpText(`http://127.0.0.1:${port}/json/list`, 5000);
  return JSON.parse(txt);
}

/** 关闭一个 target（/json/close/<id>） */
async function cdpClose(port, targetId) {
  return httpText(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(targetId)}`, 5000);
}

/** 激活（切到前台）一个 target */
async function cdpActivate(port, targetId) {
  return httpText(`http://127.0.0.1:${port}/json/activate/${encodeURIComponent(targetId)}`, 5000);
}

/**
 * 坑 2：关闭与目标无关的标签页。
 *
 * playwright 的 connectOverCDP 会初始化浏览器里**所有**已有 page target；
 * 只要有任意一个页面的渲染进程处于僵死 / 长任务卡顿状态，其 CDP 命令就永远不返回，
 * connectOverCDP 会一直挂着（连默认 30s timeout 都救不了，因为它在等 Promise 而非命令超时）。
 * 实测：同一实例 19 个标签时连不上；清到只剩 1 个目标页后 0.1s 连上。
 *
 * 坑 3（2026-10-12 新增）：**绝不能把页面关到一个不剩**。
 * Chrome 关掉最后一个标签页 = 关闭窗口 = 进程退出，`--remote-debugging-port` 随之消失，
 * 后续 connectOverCDP 直接 ECONNREFUSED（实测踩到）。因此本函数保证至少留 1 个页面。
 *
 * @param {number|string} port
 * @param {string|string[]} keep 要保留的 URL 子串（可多个）
 * @param {boolean} [aggressive] true=连 about:blank/新标签页也关
 * @returns {Promise<string[]>} 被关闭页面的 URL 列表
 */
async function closePagesExcept(port, keep, aggressive) {
  const keepList = (Array.isArray(keep) ? keep : [keep]).filter(Boolean);
  if (!keepList.length) return [];
  const targets = (await cdpList(port)).filter(t => t.type === 'page');
  const closable = targets.filter(t => {
    const url = t.url || '';
    if (keepList.some(k => url.includes(k))) return false;
    // 默认保留 devtools / 扩展页；aggressive 时连 about:blank 也清
    if (!aggressive && /^(devtools:|chrome-extension:|chrome:)/.test(url)) return false;
    return true;
  });
  // 保证至少剩 1 个页面（见「坑 3」）
  while (targets.length - closable.length < 1 && closable.length) closable.pop();

  const closed = [];
  for (const t of closable) {
    try {
      await cdpClose(port, t.id);
      closed.push(t.url || '(blank)');
    } catch (_) { /* 忽略单个失败 */ }
  }
  return closed;
}

/**
 * 带重试的 connectOverCDP。
 * ECONNREFUSED 常见于两种瞬时状态：隔离 Chrome 刚被清空页面后短暂重整、
 * 或进程刚被沙箱回收正在重启。重试 3 次基本都能过。
 */
async function connectWithRetry(cr, port, timeout, log) {
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      return await cr.connectOverCDP(`http://127.0.0.1:${port}`, { timeout });
    } catch (e) {
      last = e;
      if (log) console.warn('[pathkit] connectOverCDP 第 %d 次失败: %s', i, String(e.message).split('\n')[0]);
      if (i < 3) await new Promise(r => setTimeout(r, 1500));
    }
  }
  throw last;
}

/**
 * 共享的 playwright 直连 CDP 连接器（覆盖上面两个坑）。
 *
 * @example
 *   const pk = require('../../isolated-browser/scripts/pathkit.js');
 *   const { page } = await pk.connectCDP({ keep: 'mp.toutiao.com' });
 *
 * @param {object} opts
 * @param {number|string} [opts.port]         CDP 端口，默认 pk.cdpPort()
 * @param {string|string[]} [opts.keep]       目标页 URL 子串；命中则复用该页，未命中则新建独立标签
 * @param {boolean} [opts.closeOthers]        默认 **false**（2026-10-16 起不再自动清场，避免误关其它任务的标签）；
 *                                            显式设 true 或环境变量 PK_CLEAN=1 才恢复「关掉所有非目标页」的旧行为
 * @param {boolean} [opts.aggressive]         关闭时是否连 about:blank 也清
 * @param {number} [opts.timeout]             connectOverCDP 超时（ms），默认 45000
 * @param {boolean} [opts.log]                是否打印清理日志，默认 true
 * @returns {Promise<{browser:any, ctx:any, page:any, closed:string[]}>}
 */
async function connectCDP(opts) {
  opts = opts || {};
  const port = opts.port || cdpPort();
  const log = opts.log !== false;
  ensureNoProxy();

  // 默认**不再清场**（2026-10-16 起）：多任务可能共享同一个隔离实例（同一 CDP 端口 + 同一 profile，
  // 这是为了免登录复用而刻意共享的），此时「关掉所有非目标页」会误关其它任务正在用的标签
  // （实测误关过 微信公众号发布 / seowhy 体验站 / devdidi 等任务的标签）。
  // 需要旧行为时：显式传 { closeOthers: true }，或设环境变量 PK_CLEAN=1。
  const wantClean = opts.closeOthers === true
    || (opts.closeOthers === undefined && process.env.PK_CLEAN === '1');
  let closed = [];
  if (wantClean && opts.keep) {
    try {
      closed = await closePagesExcept(port, opts.keep, opts.aggressive);
      if (log && closed.length) console.log('[pathkit] 已关闭无关标签页 %d 个: %s', closed.length, closed.map(u => u.slice(0, 60)).join(' | '));
    } catch (e) {
      if (log) console.warn('[pathkit] 清理标签页失败（忽略继续）:', e.message);
    }
  }

  const { chromium: cr } = resolvePlaywright();
  const browser = await connectWithRetry(cr, port, opts.timeout || 45000, log);
  const ctx = (browser.contexts() && browser.contexts()[0]) || (await browser.newContext());

  const keepList = (Array.isArray(opts.keep) ? opts.keep : [opts.keep]).filter(Boolean);
  let page = null;
  // 1) 优先复用本次任务的目标页（keep 命中）
  if (keepList.length) page = ctx.pages().find(p => keepList.some(k => (p.url() || '').includes(k)));
  // 2) 其次复用「空闲空白页」（抢占空白页无副作用）
  if (!page) page = ctx.pages().find(p => /^(about:blank|chrome:\/\/newtab\/?|chrome:\/\/new-tab-page\/?)$/.test((p.url() || '').trim()));
  // 3) 最后**新建独立标签**——同 context 新建 tab 仍共享登录态，但绝不抢占其它任务的标签。
  //    （2026-10-16 前是 `ctx.pages()[0]`：会把别的任务正在用的标签抢走，`goto` 一执行对方页面就跳走了）
  if (!page) page = await ctx.newPage();
  return { browser, ctx, page, closed };
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
  // CDP 连接（含代理绕过 + 清理无关标签页两个必备修复）
  ensureNoProxy,
  cdpList,
  cdpClose,
  cdpActivate,
  closePagesExcept,
  connectWithRetry,
  connectCDP,
};

// 直接执行时打印环境快照：node pathkit.js --info
if (require.main === module) {
  console.log(JSON.stringify(info(), null, 2));
}
