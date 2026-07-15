# 复制即用模板（B 路线 · 独立浏览器）

跨平台、无硬编码。端口取未被占用的即可（默认 9222）。

## JS：拉起隔离 Chrome

```js
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

const CDP_PORT = process.env.ISOB_CDP_PORT || 9222;          // 任取未占用端口
const PROFILE  = process.env.ISOB_PROFILE_DIR || path.join(os.homedir(), '.qclaw_isolated_chrome');
const chrome   = process.env.AGENT_BROWSER_EXECUTABLE_PATH || 'chrome';

fs.mkdirSync(PROFILE, { recursive: true });
const child = spawn(chrome, [
  '--new-instance',
  `--user-data-dir=${PROFILE}`,
  `--remote-debugging-port=${CDP_PORT}`,
  '--no-first-run', '--no-default-browser-check',
  'https://example.com',           // 起始 URL
], { detached: true, stdio: 'ignore', windowsHide: true });
child.unref();
// 打开的窗口手动登录后，用下面命令驱动
```

## bash：agent-browser --cdp 直连

```bash
# 只传 --cdp，不要传 --profile（会挂起）
agent-browser --cdp 9222 open https://example.com
agent-browser --cdp 9222 snapshot -i
agent-browser --cdp 9222 eval --base64 "$(printf '%s' 'document.title' | base64)"
agent-browser --cdp 9222 screenshot ./out.png
```

## Node 内调用（引用 connect.js）

```js
const { ab, evalJS, isConnected, open, snapshot } = require('isolated-browser/scripts/connect.js');
const PORT = 9222;
if (!isConnected(PORT)) process.exit(1);
open('https://example.com', PORT);
const title = evalJS('document.title', PORT);
console.log('title =', title);
```
