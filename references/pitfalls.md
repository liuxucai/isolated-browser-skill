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
