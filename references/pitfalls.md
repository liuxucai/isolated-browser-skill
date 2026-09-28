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

### 10. playwright-core 就是本机的驱动层（替代 agent-browser）

- **位置**：`~/.workbuddy/binaries/node/workspace/node_modules/playwright-core`
- **用法**：任何脚本运行前设 `OPENCLAW_NODE_MODULES` 指向该 `node_modules` 目录。
- **连接**：`chromium.connectOverCDP('http://127.0.0.1:9222')`，本机实测通过（沙箱内直连 127.0.0.1 无阻）。
- **`connect.js` 的定位**：它是 `agent-browser --cdp` 封装，本机装好 agent-browser 前不可用；
  需要「连上浏览器 + eval/click/screenshot」时，直接用 playwright-core 写几行即可（参考各 publisher skill 的 `scripts/lib.js`）。

### 11. 沙箱写 D 盘会被杀进程

- **现象**：向 `D:\...` 写文件时进程 exit 1、日志戛然而止、无任何 traceback（曾在 `D:\skills` 留下两个空壳 git 仓库）。
- **✅ 解决**：写 D 盘的操作必须申请沙箱豁免执行；写 `C:\Users\...` 不受限。

### 12. 本机其他环境铁律（跨 skill 通用）

- **Bash 工具不可靠**：PortableGit bash 下 `ls`/`mkdir`/`git`/`which`/`dirname` 全部 command not found；
  实测同一会话中途 `head`/`grep` 也会丢失。→ 文件检索用专用工具，命令走 PowerShell，复杂逻辑写 Python/Node 脚本。
- **PowerShell 5.1 中文路径乱码**：`C:\Users\甲骨龙集成电脑\...` 被按 GBK 解码成乱码，`Test-Path` 恒 False。
  → 含中文路径的文件操作一律用 Python（`-X utf8`）；PS 脚本里不要写中文字面量，必须写时显式 `-Encoding UTF8`。
- **PowerShell 工具不回传 stdout**：结果要 `| Out-File $env:TEMP\x.txt -Encoding UTF8` 后再读。
- **git 不在 PATH**：在 `~/.workbuddy/binaries/PortableGit/versions/1.2.0/cmd/git.exe`。
- **git-bash 调 node 传参**：`/c/Users/...` 会被拼成 `c:\c\Users\...` 报 `MODULE_NOT_FOUND`，
  要传 `C:/Users/...` 风格路径。
