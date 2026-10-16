# B 路线已踩过的坑（避坑清单）

## 1. 直连时 --profile 会挂起
- **现象**：`agent-browser --profile <dir> --cdp 9222` 卡住无返回。
- **原因**：--profile 触发 agent-browser 自身会话/登录态管理，与 CDP 直连冲突。
- **解决**：连接已运行的独立实例时**只传 `--cdp`**，profile 在 launch 阶段用 `--user-data-dir` 解决，不要重复传给 agent-browser。

## 2. PowerShell 中文乱码（GBK 陷阱）
- **现象**：用 `Set-Content` 默认编码重写 UTF-8 脚本，中文变乱码、语法报错。
- **解决**：写脚本/文件一律 UTF-8；PowerShell 下别用 `Set-Content`（默认 GBK），用 write 工具或显式 `-Encoding UTF8`。eval 的 JS 走 `--base64` 也规避了这一步。

## 3. 端口占用
- CDP 端口任取未被占用者。若 9222 被占，换一个（如 18778、9333...）。实例关闭后端口释放。
- 检测：连不上时先确认 launch.js 已跑、实例 PID 存活。

## 4. 隔离 profile 务必固定且全新
- 复用用户默认 User Data 会串登录态、被其配置干扰，且可能触发 Chrome 单例锁。
- 本 skill 固定使用 `$HOME/.chrome_qclaw_stable`，首次运行自动创建，登录态可长期复用、免重复登录。可用 `ISOB_PROFILE_DIR` 覆盖。

## 5. 实例随脚本退出被杀
- `spawn` 默认子进程随父退出。发布类脚本跑完就退出会杀掉浏览器。
- 解决：`detached:true, stdio:'ignore'` + `child.unref()`，让实例常驻，供后续命令反复连接。

## 6. 不要用 cft / 测试版 Chrome
- 用正式版 Chrome。cft 路径下的实例在登录/网站校验上可能异常。

## 7. spawnSync 在 Windows 下执行 .cmd 需 shell:true
- **现象**：`spawnSync('agent-browser.cmd', [...])` 返回 `code=null`、连不上。
- **原因**：Windows 下 spawnSync 直接执行 `.cmd` 需要 shell 解释。
- **解决**：spawnSync 选项加 `shell:true`。

## 8. agent-browser 路径解析
- `where.exe agent-browser` 可能返回无扩展名项和 `.cmd` 两条；优先匹配 `.cmd`（勿优先无扩展名，否则 spawnSync 跑不起来）。

## 2026-09-22 补充：WorkBuddy 沙箱环境适配（本机实测，重要）

> 上面 1~8 条来自原作者环境（依赖 `agent-browser` CLI）。**本机未安装 `agent-browser`**，
> 因此条目 1、7、8 在本机**不适用**；本机改走 **playwright-core 直连 CDP**，`launch.js` 可直接复用。

### 9. 沙箱会回收 detached 子进程 → 隔离 Chrome 起来就死（本机头号坑）

- **现象**：`launch.js` 执行成功、当下 `curl http://127.0.0.1:9222/json/version` 有响应；
  但**该命令一结束**，Chrome 立即消失，后续脚本报 `connection refused`。
  实测复现两次，**加沙箱豁免（dangerouslyDisableSandbox）也一样**——`detached:true` + `child.unref()` 挡不住。
- **原因**：WorkBuddy 沙箱按命令粒度回收其派生的进程树。
- **✅ 解决**：把 launch 放进**后台常驻任务**，用父进程的存活期锁住 Chrome：

  ```bash
  # run_in_background = true
  node skills/isolated-browser/scripts/launch.js "https://mp.toutiao.com/profile_v4/graphic/publish" && sleep 7200
  ```

  父进程存活期间（2 小时）Chrome 全程可用；发布完可直接结束该后台任务。

- ⚠️ **「到期」信号要会认**：后台保活命令跑满 `sleep 7200` 后会**自然结束**，
  你会收到一条 `Background command … completed` 的任务通知。**这不代表发布失败，只是保活到期**。
  Chrome 通常会再多活一会儿，但应**尽快重新拉起保活**（再跑一次同样的
  `launch.js "<任意URL>" && sleep 7200`）以免被沙箱回收。
  存活性判定：`curl -s --noproxy '*' http://127.0.0.1:9222/json/version` 有 JSON 响应即还活着。
  （2026-10-12 实测：一晚内先后收到头条/公众号/抖音三个历史保活会话的到期通知，Chrome 均未掉线。）

### 10. playwright-core 就是本机的驱动层（替代 agent-browser）

- **位置**：不固定，由 `scripts/pathkit.js` 运行时探测（依次试 `OPENCLAW_NODE_MODULES` → WorkBuddy 托管 node 的 workspace → OpenClaw/qclaw 安装目录 → 就近 `node_modules`）。
- ⚠️ **本机实测（2026-10-13）：qclaw 目录整体消失导致全部脚本瘫痪**。
  原可解析的 `F:\qclaw\<ver>\resources\openclaw\node_modules` 因 `F:\qclaw` 被移除而失效，
  所有 publisher 脚本统一报「未找到 playwright-core」。**处置**——重装到 pathkit 的**首选**位置：
  ```bash
  node "<node>/node_modules/npm/bin/npm-cli.js" i playwright-core \
       --prefix "$HOME/.workbuddy/binaries/node/workspace" --no-audit --no-fund
  ```
  ⚠️ **必须带 `--prefix`**：不带时本机 npm 会按默认 root 装到 `C:\Users\<用户名>\node_modules`，
  pathkit 探测不到那个位置。装完用 `node isolated-browser/scripts/pathkit.js --info`
  确认 `nodeModules` 非空即成功。
- **用法**：脚本 `require('../../isolated-browser/scripts/pathkit.js').resolvePlaywright()` 即可，**不需要**手工设环境变量；要强制指定时才设 `OPENCLAW_NODE_MODULES`。
- **连接**：`chromium.connectOverCDP('http://127.0.0.1:9222')`，本机实测通过（沙箱内直连 127.0.0.1 无阻）。
- **`connect.js` 的定位**：它是 `agent-browser --cdp` 封装，本机装好 agent-browser 前不可用；
  需要「连上浏览器 + eval/click/screenshot」时，直接用 playwright-core 写几行即可（参考各 publisher skill 的 `scripts/lib.js`）。

### 11. 沙箱写 D 盘会被杀进程

- **现象**：向 `D:\...` 写文件时进程 exit 1、日志戛然而止、无任何 traceback（曾在 `D:\skills` 留下两个空壳 git 仓库）。
- **✅ 解决**：写 D 盘的操作必须申请沙箱豁免执行；写 `C:\Users\...` 不受限。

### 12. 本机其他环境铁律（跨 skill 通用）

- **Bash 工具不可靠**：PortableGit bash 下 `ls`/`mkdir`/`git`/`which`/`dirname` 全部 command not found；
  实测同一会话中途 `head`/`grep` 也会丢失。→ 文件检索用专用工具，命令走 PowerShell，复杂逻辑写 Python/Node 脚本。
- **PowerShell 5.1 中文路径乱码**：形如 `C:\Users\<中文用户名>\...` 的路径被按 GBK 解码成乱码，`Test-Path` 恒 False。
  → 含中文路径的文件操作一律用 Python（`-X utf8`）；PS 脚本里不要写中文字面量，必须写时显式 `-Encoding UTF8`。
- **PowerShell 工具不回传 stdout**：结果要 `| Out-File $env:TEMP\x.txt -Encoding UTF8` 后再读。
- **git 不在 PATH**：在 `~/.workbuddy/binaries/PortableGit/versions/1.2.0/cmd/git.exe`。
- **git-bash 调 node 传参**：`/c/Users/...` 会被拼成 `c:\c\Users\...` 报 `MODULE_NOT_FOUND`，
  要传 `C:/Users/...` 风格路径。

### 13. 沙箱代理劫持 CDP 连接（2026-10-12，跨 skill 通用）

- **现象**：playwright `connectOverCDP` 30s 超时，日志里 ws 地址被改写成
  `ws://127.0.0.1:9300/...`（9300 是沙箱 HTTP 代理端口，不是 Chrome）。
- **根因**：沙箱注入 `http_proxy=http://127.0.0.1:9300`，playwright 请求
  `http://127.0.0.1:9222/json/version` 时走了代理，返回的 webSocketDebuggerUrl 被改写。
- **✅ 解决**：把回环地址加进 `NO_PROXY`（不动 http_proxy，联网下载图片仍可走代理）。
  已固化在 `pathkit.js` 的 `ensureNoProxy()`，`connectCDP()` 会自动调用；
  手写脚本直接连时务必自行设置 `NO_PROXY=127.0.0.1,localhost`。

### 14. 「僵死」标签页让 connectOverCDP 永久挂起（2026-10-12，跨 skill 通用）

- **现象**：浏览器开了十几个标签页时 connectOverCDP 超时；清到只剩目标页后 **0.1s 连上**。
- **根因**：connectOverCDP 会初始化**所有**已有 page target；只要任意一个页面的渲染进程
  无响应（其 CDP session 的 `Page.enable` 等命令永远不返回，用 `DEBUG=pw:protocol` 可见
  大量 pending 命令），整个连接就挂死——连默认 timeout 都救不了，因为它在等 Promise。
- **✅ 解决**：连接前用 CDP HTTP API（`/json/list` + `/json/close`）关闭非目标页面。
  已固化在 `pathkit.js` 的 `closePagesExcept()` / `connectCDP({ keep: '目标域名' })`。
- **注意**：目标页自己也可能僵死（表现：DOM 在、evaluate 通、但点击零反应且无遮罩拦截），
  此时关闭重开页面是唯一解；"长时间开着的编辑页"尤其容易这样（头条实测：封面加号块、
  radio 全部点不动，reload 也无效）。

### 15. 把页面关到 0 个 = 关掉 Chrome 窗口 = 进程退出（2026-10-12，跨 skill 通用）

- **现象**：`closePagesExcept` 清理后（keep 列表没匹配到任何页面时，会把**所有**标签页都关掉），
  紧接着 `connectOverCDP` 报 `connect ECONNREFUSED 127.0.0.1:9222`，但几秒前 `/json/version` 还正常。
- **根因**：Chrome 关掉**最后一个**标签页 = 关闭窗口 = 进程退出，`--remote-debugging-port` 随之消失。
  keep 子串没写对（或页面 URL 变了）时，"保留目标页" 就变成了 "关光所有页"。
- **✅ 解决**：`closePagesExcept()` 内置**至少留 1 个页面**的保护（2026-10-12 起生效）；
  另外 `connectCDP()` 增加了 `connectWithRetry`（ECONNREFUSED 自动重试 3 次，间隔 1.5s）。
- **自检口诀**：调 `closePagesExcept` 前先 `/json/list` 确认 keep 子串真的能命中目标页。

### 16. 沙箱内 node 直连本机 CDP 也会被拒（2026-10-12，跨 skill 通用）

- **现象**：`curl http://127.0.0.1:9222/json/version` 通（curl 走沙箱代理转发），但
  同一条 Bash 命令里 `node -e "http.get('http://127.0.0.1:9222/...')"` 报 `ECONNREFUSED`；
  `node check-login.js` 同样报连不上——**即使 URL 一样**。
- **根因**：WorkBuddy 沙箱对 node 的原生 TCP 直连做了拦截；curl 因走 HTTP 代理（9300）
  反而能到。即 #13 的反面：加了 `NO_PROXY` 后 node 直连，直连本身被沙箱拦。
- **✅ 解决**：凡是「node 脚本 + 连本机 CDP」的命令，一律**申请沙箱豁免**执行
  （`dangerouslyDisableSandbox: true`）。这与 #9（launch 需后台保活）是两条独立的坑。
- **判别法**：同一 URL，curl 通 + node refused → 沙箱问题，别去查 Chrome。

### 17. 多任务共享隔离实例时互相「关标签 / 抢标签」（2026-10-16，跨 skill 通用）

- **现象**：一个任务执行后，**别的任务**（微信公众号发布、seowhy 体验站、devdidi 等）正在用的标签
  被关掉或被导航走。日志证据：
  `[pathkit] 已关闭无关标签页 4 个: 6.seowhy.com/... | channels.weixin.qq.com/post/list | channels.weixin.qq.com/post/create | devdidi.seowhy.com/...`
- **根因**：本 skill 的 `isolated` 指的是「**自动化 ↔ 用户日常浏览器**」这一对，
  **没有**「**任务 ↔ 任务**」这一层的隔离。而所有任务被迫共用同一实例
  （CDP 9222 + profile `~/.chrome_qclaw_stable`）——这是为**免登录复用**刻意共享的（登录页有验证码，无法自动登）。
  在这个前提下，旧版 `connectCDP()` 的两处写法会主动伤人：
  1. `closeOthers` 默认 `true`（只要传了 `keep`）→ `closePagesExcept()` 关掉所有不含 `keep` 的标签 = **清场清掉别人**；
  2. 未命中 `keep` 时 `page = ctx.pages()[0]` = **顺手抢占别人的标签**（`goto` 一执行对方页面就跳走了）。
- **✅ 解决**（2026-10-16 起）：
  - `closeOthers` 默认改为 **false**（默认不再清场）；
  - 选页改为「**keep 命中 → 复用空闲空白页 → 新建独立 tab**」，绝不抢占他人标签。
  同 context 新建 tab 仍共享登录态，所以**免登录性质不变**，发布链路不受影响。
- **需要旧清场行为时**：显式 `{ closeOthers: true }`，或设环境变量 **`PK_CLEAN=1`**
  （标签太多导致 `connectOverCDP` 挂住时用，见 #14）。
- **配套义务**：脚本收尾尽量 `await page.close()`，否则长跑后标签会缓慢堆积（内存开销很小，但不是零）。
