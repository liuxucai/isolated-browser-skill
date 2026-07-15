---
name: isolated-browser
description: 启动一个与用户默认浏览器完全隔离的独立 Chrome 实例，并用 agent-browser --cdp 直连驱动，绕开 xb 安全锁。当用户已开着自己的 Chrome/Edge、不想关闭、又需要自动化浏览器操作时使用。适用于任何需要"不打扰用户现有浏览器"的发布/爬虫/表单填写类 skill。触发词：独立浏览器、隔离实例、不打扰用户浏览器、xb 安全锁、CDP 直连、launch isolated chrome。
---

# 独立浏览器实例 Skill（B 路线 · 跨平台通用）

## 这是什么

一套"启动隔离 Chrome + agent-browser 直连"的可复用能力。**不依赖 xb CLI**，只依赖：
- 系统稳定版 Chrome（非 cft 测试版）
- 全局 `agent-browser` CLI（即 agent-browser 包，qclaw 自带）
- Node.js

> 本 skill **只提供 B 路线**（隔离实例 + CDP 直连）。如需让 xb 托管浏览器（要求用户先关闭其 Chrome），请走对应 skill 自带的 xb 路径，不在本 skill 范围内。

## 为什么用 B 路线

xb 有安全锁：检测到用户已在跑 Chrome/Edge 就拒绝另起实例。B 路线手动拉一个**隔离** Chrome，用 `agent-browser --cdp` 直连，**完全不碰用户浏览器**，因此无需打扰用户。

## 核心原则（最高优先级，跨 skill 通用）

1. **绝不混用用户浏览器**——只用本 skill 拉起的隔离实例；**绝不直接 `exec chrome.exe` 拿用户实例**。
2. **隔离 profile 是固定的**——实例使用当前用户主目录下的 `.chrome_qclaw_stable` 作为 `--user-data-dir`，与用户默认 User Data 不串登录态，且可长期复用、免重复登录。可用环境变量 `ISOB_PROFILE_DIR` 覆盖。
3. **登录不填密码**——开登录页让用户手动操作。
4. **中文编码**——写脚本/文件用 UTF-8；PowerShell 下别用 `Set-Content` 默认编码重写（会 GBK 乱码），用 write 工具或显式 UTF-8。
5. **只传 `--cdp`，不传 `--profile`**——直连时同时传 `--profile` 实测会挂起卡死。

## 快速用法

```bash
# 1) 拉起隔离 Chrome（固定 profile ~/.chrome_qclaw_stable + 独立 CDP 端口），手动登录目标站点
node skills/isolated-browser/scripts/launch.js

# 2) 直连驱动（只传 --cdp，不传 --profile）
agent-browser --cdp 9222 open https://example.com
agent-browser --cdp 9222 snapshot -i
agent-browser --cdp 9222 eval --base64 <base64的JS>
agent-browser --cdp 9222 screenshot ./out.png
```

环境变量（均可覆盖，避免硬编码）：
- `ISOB_CDP_PORT` — CDP 端口，默认 `9222`（任取未被占用的端口）
- `ISOB_PROFILE_DIR` — 隔离 profile 目录，默认 `$HOME/.chrome_qclaw_stable`
- `AGENT_BROWSER_EXECUTABLE_PATH` — 指定稳定版 Chrome 路径（可选）

## 启动参数组合（已验证正确）

```
chrome --new-instance
       --user-data-dir=<$HOME/.chrome_qclaw_stable>
       --remote-debugging-port=<未占用端口>
       --no-first-run --no-default-browser-check
       <起始URL>
```

后台常驻关键：`spawn(chrome, args, {detached:true, stdio:'ignore'})` 后 `child.unref()`，实例才不会随脚本退出被杀。

## 与其他 skill 的集成方式

其他发布/填写类 skill 可以：
- **直接复用** `scripts/launch.js` 启动实例；
- **直接复用** `scripts/connect.js` 做连通性检查与基础动作封装；
- 或仅**参考本 SKILL.md 的规则**，自己内联同样的启动逻辑（复制即用模板见 `references/template.md`）。

覆盖守卫、内容填写、发布判定等业务逻辑由各调用方 skill 负责；本 skill 只负责"把隔离浏览器拉起来并连上"。

## 文件结构

```
isolated-browser/
├── SKILL.md                       ← 本文件
├── scripts/
│   ├── launch.js                  ← 拉起隔离 Chrome（detached 常驻，固定 ~/.chrome_qclaw_stable）
│   └── connect.js                 ← agent-browser --cdp 基础封装 + 连通性检查
└── references/
    ├── template.md                ← 复制即用的最小模板（JS + bash）
    └── pitfalls.md                ← 已踩过的坑（--profile挂起/GBK乱码/端口占用/spawnSync需shell:true）
```

详见 [references/template.md](references/template.md) 与 [references/pitfalls.md](references/pitfalls.md)。
