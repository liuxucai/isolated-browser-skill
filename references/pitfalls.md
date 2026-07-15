# B 路线已踩过的坑（避坑清单）

## 1. xb 安全锁
- **现象**：用 xb 托管 Chrome 时，若用户已在跑 Chrome/Edge，xb 的 `ensureConnection` 拒绝另起实例（报"Chrome 正在运行但未启用 CDP"）。
- **解决**：改走 B 路线——手动拉隔离实例 + `agent-browser --cdp` 直连。

## 2. 直连时 --profile 会挂起
- **现象**：`agent-browser --profile <dir> --cdp 9222` 卡住无返回。
- **原因**：--profile 触发 agent-browser 自身会话/登录态管理，与 CDP 直连冲突。
- **解决**：连接已运行的独立实例时**只传 `--cdp`**，profile 在 launch 阶段用 `--user-data-dir` 解决，不要重复传给 agent-browser。

## 3. PowerShell 中文乱码（GBK 陷阱）
- **现象**：用 `Set-Content` 默认编码重写 UTF-8 脚本，中文变乱码、语法报错。
- **解决**：写脚本/文件一律 UTF-8；PowerShell 下别用 `Set-Content`（默认 GBK），用 write 工具或显式 `-Encoding UTF8`。eval 的 JS 走 `--base64` 也规避了这一步。

## 4. 端口占用
- CDP 端口任取未被占用者。若 9222 被占，换一个（如 18778、9333...）。实例关闭后端口释放。
- 检测：连不上时先确认 launch.js 已跑、实例 PID 存活。

## 5. 隔离 profile 务必全新
- 复用用户默认 User Data 会串登录态、被其配置干扰，且可能触发 Chrome 单例锁。
- 必须 `--user-data-dir` 指向一个**全新目录**（`mkdir -p` 后传给 Chrome）。

## 6. 实例随脚本退出被杀
- `spawn` 默认子进程随父退出。发布类脚本跑完就退出会杀掉浏览器。
- 解决：`detached:true, stdio:'ignore'` + `child.unref()`，让实例常驻，供后续命令反复连接。

## 7. 不要用 cft / 测试版 Chrome
- 用正式版 Chrome。cft 路径下的实例在登录/网站校验上可能异常。
