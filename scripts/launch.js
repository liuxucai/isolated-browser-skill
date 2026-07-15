#!/usr/bin/env node
/**
 * 启动一个与用户默认 Chrome 完全隔离的独立 Chrome 实例。
 *
 * 用法：
 *   node scripts/launch.js
 *   ISOB_CDP_PORT=9222 node scripts/launch.js
 *
 * 启动后请在新窗口手动登录目标站点，再用 agent-browser --cdp <port> 驱动。
 * profile 固定为 ~/.chrome_qclaw_stable（用户主目录下），登录态可长期复用。
 *
 * 依赖：系统稳定版 Chrome、Node.js。不依赖 xb CLI。
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---- 默认参数（环境变量可覆盖，避免硬编码）----
// CDP 端口取一个未被占用的即可；9222 是 agent-browser / Chrome 的常用默认。
const CDP_PORT = process.env.ISOB_CDP_PORT || 9222;
// profile 固定为当前用户目录下的 .chrome_qclaw_stable
const PROFILE_DIR = process.env.ISOB_PROFILE_DIR
  || path.join(os.homedir(), '.chrome_qclaw_stable');

// ---- 解析 Chrome 可执行文件 ----
function findChrome() {
  const cands = [
    process.env.AGENT_BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean);
  for (const c of cands) {
    if (c && fs.existsSync(c)) return c;
  }
  return 'chrome'; // 期望在 PATH 中
}

const chrome = findChrome();

if (!fs.existsSync(chrome)) {
  console.error('找不到 Chrome 可执行文件:', chrome);
  console.error('  请设置 AGENT_BROWSER_EXECUTABLE_PATH 指向稳定版 Chrome，或把 Chrome 加入 PATH。');
  process.exit(1);
}

fs.mkdirSync(PROFILE_DIR, { recursive: true });

const args = [
  '--new-instance',                                  // 独立进程（Chrome 参数，非 xb 参数）
  `--user-data-dir=${PROFILE_DIR}`,                  // 固定隔离 profile，与默认 User Data 互不串
  `--remote-debugging-port=${CDP_PORT}`,             // 开放 CDP，供 agent-browser --cdp 直连
  '--no-first-run',
  '--no-default-browser-check',
  process.argv[2] || 'https://www.jianshu.com/writer#/', // 起始 URL 可命令行传入
];

console.log('=== 启动独立 Chrome 实例 ===');
console.log('Chrome  :', chrome);
console.log('Profile :', PROFILE_DIR);
console.log('CDP端口 :', CDP_PORT);
console.log('');

const child = spawn(chrome, args, { detached: true, stdio: 'ignore', windowsHide: true });
child.unref();

child.on('error', (e) => {
  console.error('启动失败:', e.message);
  process.exit(1);
});

// 给一点时间让进程起来
setTimeout(() => {
  console.log(`已发起独立 Chrome（PID ${child.pid}）。`);
  console.log('');
  console.log('下一步：');
  console.log('  1. 在打开的窗口中手动登录目标站点（不填密码，由用户操作）');
  console.log('  2. 用 agent-browser --cdp 直连驱动：');
  console.log(`     agent-browser --cdp ${CDP_PORT} snapshot -i`);
  console.log('');
  console.log('注意：该实例使用 ~/.chrome_qclaw_stable 作为隔离 profile，与你的默认浏览器登录态互不串，可长期使用、免重复登录。');
}, 1500);
