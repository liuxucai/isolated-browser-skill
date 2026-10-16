# 跨平台「配图 3 张 + 封面」统一约定（2026-10-12）

> 本文件是 **12 个发布类 skill 的公共约定**。任何平台想改配图逻辑，先读这里，**不要在单个 skill 里另发明一套参数**。

## 一、目标约定

1. **正文配图统一 3 张**（默认）。挑选口径由用户定死为两步：
   **① 先由 `tag.txt` 匹配文章标签（可多个）→ ② 再按这些标签从 `pic-tag.txt` 挑最匹配的 3 张**。
2. **封面能设 3 张的平台尽量设 3 张**：
   - **百家号**：支持「单图/三图」，走三图 → 3 个槽位逐槽上传（详见 `baijiahao-publish-skill`）。
   - **头条号**：支持「无图/单图/三图」，走三图 → 3 个加号块逐个上传（`toutiao-publish-skill/scripts/upload-cover3.js`）。
   - **其余平台**（知乎/简书/CSDN/B站/搜狐/网易号/企鹅号/抖音/微信公众号）：封面只支持单张 → **取配图的第 1 张**。
     - 注：**抖音**（2026-10-12 改版）连正文头图也只支持 1 张，故正文与封面实际同用第 1 张。
3. **严禁自行生成配图**（不得用 canvas / pollinations 之类兜底）；配图只能来自「调用方给的本地路径」或「素材库挑选」。

## 二、统一参数命名（所有平台必须一致）

| 参数 | 含义 | 备注 |
|---|---|---|
| `--image <path>` | 手动指定配图，**可重复**（按给定顺序） | 覆盖自动挑选 |
| `--no-image` | 不要配图 | |
| `--keyword <s>` | 自动挑图关键词 | 缺省用文章标题 |
| `--tags "a,b"` | 文章标签（须取自 `tag.txt` 原文） | 缺省按关键词自动推荐 |
| `--image-top <N>` | 自动挑选张数 | 默认 3 |
| `--image-layout <s>` | `spread`（默认，均分到不同段落之间）｜`group`（连续插在同一处） | |
| `--image-at <N>` | `group` 模式的锚点（插在第 N 段之后） | |
| `--image-dir <dir>` | 素材目录 | 不传则自动探测 |

**参数载体不同的平台**（有的走环境变量、有的走位置参数、有的走 JSON）用**同一套语义**，只把前缀/载体换掉：

| 平台 | 变量 |
|---|---|
| 企鹅号 | `QQ_IMAGES` / `QQ_NO_IMAGE` / `QQ_KEYWORD` / `QQ_TAGS` / `QQ_IMAGE_TOP` / `QQ_IMAGE_LAYOUT` / `QQ_IMAGE_AT` |
| 抖音 | 图片走**位置参数**（可多个）；`--keyword` / `--tags` / `--image-top` / `--image-dir` / `--no-image` |
| 微信公众号 | `content.json` 的 `images[]`（数组）/ `no_image` / `keyword` / `tags` / `image_top` / `image_dir` |

## 三、共享工具（都在 `isolated-browser/scripts/`，各 skill **相对引用、不复制**）

| 文件 | 作用 |
|---|---|
| `pathkit.js` | 跨机器路径解析：`resolvePlaywright()` / `chromium()` / `resolveNodeModules()` / `--info` 环境快照 |
| `launch.js` | 拉起隔离 Chrome（profile `~/.chrome_qclaw_stable`，CDP `9222`，可传起始 URL，内置防节流四参数） |
| `connect.js` | CDP 连接封装（`evalJS` / `open` / `isConnected` / `sleep`） |
| `pick_images.js` | 按「文章标签 → 素材库」挑 Top-N（默认 3） |
| `post_images.js` | `planImages()`：显式/自动挑选 + 算出插入锚点 `slots` |

引用方式（相对路径，**禁止写死盘符/用户名**）：

```js
const { planImages } = require('../../isolated-browser/scripts/post_images.js');
const { images, slots, source, detail, layout } = planImages({
  explicit: args.image,          // 可重复收集成的数组
  noImage: args['no-image'],
  keyword: args.keyword || TITLE,
  tags: args.tags,
  top: args['image-top'],
  layout: args['image-layout'],
  at: args['image-at'],
  dir: args['image-dir'],
  paraCount: PARAS.length,       // 给了才算 slots
});
```

`slots[i]` = **第 i 张图插在第几段之后（1-based）**：
- `spread`（默认）：`round((i+1)/(count+1) * 段数)`，把图均分到正文不同段落之间；
- `group`：全部等于 `at`（缺省正文中段），即**连续插在同一处**。

素材目录探测顺序（`pick_images.js`）：`--dir` → `PUBLISH_IMAGE_DIR` → `<本文件>/../../car`（skills 根旁的 `car/`）→ `~/car` → `./car`。

## 四、跨平台通用坑（各平台踩坑的共同点）

1. **多张必须「逐张」处理**：无论 paste / drop / file input，一次性塞多个文件都不可控。
2. **多张时倒序插入**（或按锚点从后往前）：每插一张都会新增块，正序插会让后面尚未处理的锚点索引整体后移。
   受影响：知乎、B站、搜狐、企鹅号（已全部改为倒序）。
3. **插图优先用「粘贴/拖放事件」，不要用工具栏图片按钮**：
   - B站：工具栏按钮插的是本地 base64 节点，不触发 `upload_bfs`；
   - 企鹅号：任何文件选择器路线都会**冻结浏览器**；
   - CSDN / 网易号 / 微信公众号：paste / drop 是唯一验证可行的方案。
4. **计数要过滤占位符**：ProseMirror / DraftJS 会插 `src` 为空的占位 `img`
   （B站 `.ProseMirror-separator`、知乎 `[contenteditable] img`、微信公众号 `ProseMirror-separator`）。
   真实图片按 `img[src^="http"]` 或 `src` 含平台图床域名来数。
5. **等"上传完成"要看图片数递增**，不要只看 toast / 按钮状态（toast 会残留、按钮会永久 enable）。
6. **多图时"上传成功 ≠ 已进正文"**：搜狐必须点弹窗「确定」、简书/微信公众号必须先上传再重组正文。
7. **视口外坐标点击落空（2026-10-12 头条/微信公众号/搜狐三平台同坑）**：`page.mouse.click`
   用视口坐标，`getBoundingClientRect` 对视口外元素返回的 y 远超视口高 → 点击打在视口外，
   无反应无报错。任何"按坐标点击"的工具都必须先 `scrollIntoView` → 等 350ms → **重取坐标**再点
   （微信公众号 `clickSel/clickExact`、搜狐 `li.publish-report-btn` 均已按此修复）。
7. **参数解析统一支持重复传参**（`argAll` / `push` 到数组），不要用「最后一个覆盖前面的」写法。

## 五、各平台实现与验证状态（2026-10-12）

| 平台 | 主脚本 | 多图实现方式 | 真实发布验证 |
|---|---|---|---|
| 百家号 | `publish_with_image.js` + `cover_local.js` | 逐张插图；**三图封面逐槽** | ✅ 已验证（含三图封面） |
| 知乎 | `zhihu_publish_pw.js` | 先输完正文 → 按锚点**倒序** Range 定光标插图 | ✅ 已发布 `zhuanlan.zhihu.com/p/2093043735680632461`（3 图 0→1→2→3） |
| B站 | `bili_publish_pw.js` | paste + 倒序；草稿校验图床 URL | ✅ 已发布 `bilibili.com/opus/1258264021493088277`（3 图 bfs/new_dyn 外链） |
| CSDN | `publish_pw.js` | CKEditor paste；`<!--IMAGE-->` 标记 N 个或按段均分 | ✅ 3 图 + 2 标签 |
| 简书 | `jianshu_publish_pw.js` | 弹窗 `#kalamu-upload-image` 一次传数组（multiple） | ✅ 3 图 |
| 搜狐 | `sohu_publish_pw.js` | 逐张「上传 → 弹窗缩略图 → 点确定」+ 倒序 | ✅ 3 图 |
| 头条号 | `insert-inline-safe.js` + `upload-cover3.js` | `--img/--anchor` 重复 + `--current`；三图封面（正文有图时自动转存填充） | ✅ 已发布：正文 3 图 + 三图封面 + 两步发布 |
| 网易号 | `publish.cjs` | 逐张 DataTransfer `drop` | ⏳ 待登录后验证 |
| 企鹅号 | `publish_isob.js` | 新增 `insertImages()`：paste + 倒序 | ⏳ 待登录后验证 |
| 抖音 | `publish_car.js` | 头图逐个 fileChooser（入口消失即停）；封面取第 1 张 | ✅ 已发布（17:40）；⚠️ 平台改版后**文章头图仅 1 张**（单选 input，传完入口卸载） |
| 微信公众号 | `publish_pw.js` | 逐张上传取 `outerHTML` → 最后统一重组正文 | ✅ 已发表（17:24，管理员扫码验证）；封面「从正文选择」成功 |

> 「⏳」= 代码已改完、逻辑与已跑通平台同源，但**本机当时该平台未登录**，尚未真实发布验证。
> 登录隔离 Chrome 后按各 skill `references/workflow.md` 跑一次即可确认。

### ⚠️ 上表「✅」的含义要分清（2026-10-12 晚核实）

上表的 ✅ 分两种，**不要**当成"这篇指定文章已发布"：
- **链路已验证**（百家号 / 知乎 / B站 / CSDN / 简书 / 搜狐）：脚本能走完"填稿 → 插图 → 提交"，配图数/锚点都对。
- **真实发布成功**（头条号 / 微信公众号 / 抖音）：内容管理页/发表记录页能查到该篇。

2026-10-12 统一投放《婚车租车怎么选不踩坑？车型、价格、预订时机一篇讲透》的**实况核实**：

| 平台 | 这篇的实际结果 | 核实位置 |
|---|---|---|
| 微信公众号 | ✅ 17:24 已发表 | 发表记录页 |
| 头条号 | ✅ 17:01 已发布 | 内容管理 `listHit=true` |
| 抖音 | ⚠️ 17:40 提交成功，**次日（10-13）复查已被平台无声下架**（后台三筛选全空 + 主页作品归 0，P19） | 内容管理页 + `user/self?showTab=post` |
| 简书 | ✅ 15:08:36 已发布（825 字） | `jianshu.com/p/85cc3a5bf8ca` |
| 搜狐号 | ✅ 15:22 提交成功（审核中） | 后台内容列表 |
| CSDN | ⚠️ 15:07 提交 + 18:20 重发，**两次均审核未通过** | `mp.csdn.net` 内容管理「审核中/未通过(2)」→ 原样重发无效（见 CSDN skill Q22） |
| 百家号 | ❌ 按用户指示**不投这篇**（当日已发 09:24《商务用车…》、10:35《结婚订婚车全流程…》，均「已发布已推荐」） | 内容管理（共 37 篇） |
| 知乎 | ✅ 18:23 发布 `zhuanlan.zhihu.com/p/2093043735680632461`（首轮 2 图，修 `n>0` 误判 bug 后 `--edit-url` 重跑补齐 3 图） | 公开页 `imgCount=3` |
| B站 | ✅ 18:27 发布 `bilibili.com/opus/1258264021493088277`（风控验证码 `dVGkr` 一次通过；3 图 bfs/new_dyn 外链） | `--status` + 公开页 |
| 企鹅号 | ⏳ 未登录 | — |
| 网易号 | ⏳ 未登录 | — |

> 结论（10-13 更新）：**9 个平台脚本链路全部跑通；同一篇文章落地后仍存活 6 个**
> （微信公众号 / 头条号 / 简书 / 搜狐 / 知乎 / B站）；**抖音**发布次日被平台无声下架（P19）；
> 百家号按用户指示不投；CSDN 提交成功但被平台审核拒（重发无效，须换标题/改写正文）；企鹅号、网易号待人工登录。
> **教训**：「发布成功」三查只证明提交成功，各平台都可能事后下架——**发布次日必须复查存活**。

### 封面设置状态（2026-10-13 新要求：每个平台尽量设置文章封面）

| 平台 | 封面机制 | 状态 |
|---|---|---|
| 头条号 | 三图封面（正文有图时自动转存填充） | ✅ 发布时已设 |
| 微信公众号 | 封面「从正文选择」 | ✅ 发布时已设 |
| 抖音 | 头图 1 张即封面（必填） | ⚠️ 发布时已设，但文章次日被下架（P19）；重发须改写内容 |
| 知乎 | 独立封面字段，编辑页「添加封面」→ `input.UploadPicture-input` 上传，无确认弹窗 | ✅ 10-13 补设成功（og:image 生效；**已发布可补**） |
| CSDN | 自动取正文第一张图 | ✅ 自动满足 |
| 简书 | 列表缩略图 = 正文第一张图；og:image 为平台默认头像（不可控） | ✅ 正文 3 图 |
| B站 | 「发布设置 → 自定义封面」开关默认关；**已发布 opus 无法网页补设**（P19 三路全堵） | ⚠️ 下次发布时设（脚本 `--cover` 待并入） |
| 搜狐 | 发布界面有封面项，脚本未自动化；后台被滑块验证码拦 | ⚠️ 待人工过滑块后补 |
| 企鹅号 / 网易号 | 未登录 | ⏳ 登录后发布时设 |
| 百家号 | 用户指示不投 | — |
