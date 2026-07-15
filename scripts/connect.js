#!/usr/bin/env node
/**
 * agent-browser --cdp 基础封装（B 路线 · 通用，不依赖 xb）
 *
 * 提供：路径解析（不写死）、连通性检查、常用动作封装。
 * 其他 skill 可 require 本模块，或仅参考其逻辑。
 *
 * 依赖：全局 agent-browser CLI、已运行的独立 Chrome（带 CDP）。
 */

const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_CDP_PORT = 9222;

// ---- 解析 agent-browser 可执行文件（不写死路径）----
// 注意：Windows 下 `where agent-browser` 会返回 .ps1 包装脚本，
// 但 spawnSync 不能直接把 .ps1 当可执行体运行。优先取 .cmd / 真实 exe。
function resolveAgentBrowser() {
  try {
    const lines = execSync('where.exe agent-browser', { encoding: 'utf8', shell: true })
      .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    // 优先 .cmd（Windows 可直接 spawn），其次无扩展名（shell 解析），最后兜底 .ps1
    const prefer = lines.find(l => l.toLowerCase().endsWith('.cmd'))
      || lines.find(l => l.toLowerCase().endsWith('.exe'))
      || lines[0];
    if (prefer && fs.existsSync(prefer)) return prefer;
  } catch (e) { /* 继续兜底 */ }
  const cands = [
    path.join(os.homedir(), 'AppData/Roaming/QClaw/npm-global/agent-browser.cmd'),
    path.join(os.homedir(), 'AppData/Roaming/QClaw/npm-global/agent-browser'),
    '/usr/local/bin/agent-browser',
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return 'agent-browser'; // 期望在 PATH
}

const AB = resolveAgentBrowser();

/** 执行一条 agent-browser 命令（始终带 --cdp）。返回 {code,out,err} */
function ab(args, opts = {}) {
  const cdp = ['--cdp', String(opts.cdpPort || DEFAULT_CDP_PORT)];
  const r = spawnSync(AB, [...cdp, ...args], {
    encoding: 'utf8',
    timeout: opts.timeout || 28000,
    windowsHide: true,
    shell: true,                 // Windows 下执行 .cmd 需要 shell 解释
    maxBuffer: 20 * 1024 * 1024,
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

/** 执行 JS eval（base64 规避中文乱码），返回求值结果字符串 */
function evalJS(js, cdpPort) {
  const r = ab(['eval', '--base64', Buffer.from(js, 'utf8').toString('base64')], { cdpPort, timeout: 15000 });
  const out = (r.out || '').trim();
  if (!out) return '';
  try {
    const j = JSON.parse(out);
    if (j && typeof j === 'object') {
      if ('result' in j) return j.result;
      if ('value' in j) return j.value;
      if (j.data && 'result' in j.data) return j.data.result;
    }
    return out;
  } catch (e) {
    return out;
  }
}

/** 连通性检查：能拿到 URL 即视为已连上独立实例 */
function isConnected(cdpPort) {
  const r = ab(['get', 'url'], { cdpPort, timeout: 10000 });
  if (r.code !== 0) {
    console.error(`无法经 CDP 端口 ${cdpPort} 连接 Chrome。请先运行 launch.js。`);
    return false;
  }
  console.log('已连接独立 Chrome, 当前 URL:', (r.out || '').trim());
  return true;
}

function open(url, cdpPort) { return ab(['open', url], { cdpPort, timeout: 25000 }); }
function snapshot(cdpPort) { return ab(['snapshot', '-i'], { cdpPort, timeout: 20000 }).out; }
function screenshot(name, cdpPort) {
  const filepath = path.join(os.homedir(), '.qclaw', `iso-${name}-${Date.now()}.png`);
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  const r = ab(['screenshot', filepath], { cdpPort });
  if (r.code === 0) console.log('截图已保存:', filepath);
  return r.code === 0 ? filepath : null;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { AB, DEFAULT_CDP_PORT, ab, evalJS, isConnected, open, snapshot, screenshot, sleep };

// 命令行直接跑：node connect.js <cdpPort?> 做连通性检查
if (require.main === module) {
  const port = parseInt(process.argv[2], 10) || DEFAULT_CDP_PORT;
  process.exit(isConnected(port) ? 0 : 1);
}
