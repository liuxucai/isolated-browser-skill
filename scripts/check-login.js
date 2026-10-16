#!/usr/bin/env node
/**
 * check-login.js — 跨平台「真实登录态」一键复核（发布类 skill 的公共工具）
 *
 * 为什么需要：批量发布前先确认哪些平台还登录着，避免跑到一半才发现被踢到扫码页。
 *
 * 判定口径（三查，避免误报「已登录」）：
 *   1) URL 是否仍停在目标工作台域（hosts）；
 *   2) URL / 页面正文是否含登录特征（loginRe，如 passport/signin/扫码登录）；
 *   3) 页面正文是否出现工作台特征词（expectRe，可选，缺失只降级为 warn 不算 fail）。
 *
 * 连接层已内置两大修复（见 pathkit.js）：
 *   - 沙箱注入 http_proxy 导致 CDP ws 地址被改写 → ensureNoProxy()
 *   - playwright connectOverCDP 初始化所有 page target 时被僵死页挂死 → 先关掉无关标签页
 *
 * 用法：
 *   node check-login.js                 # 检查全部平台
 *   node check-login.js toutiao sohu    # 只检查指定平台
 *   node check-login.js --json          # 只输出 JSON（便于上层脚本消费）
 *   ISOB_CDP_PORT=9222 node check-login.js
 */

'use strict';

const path = require('path');
const pk = require(path.join(__dirname, 'pathkit.js'));

const PORT = pk.cdpPort();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// key, 中文名, 工作台 URL, 工作台域, 登录特征正则, 工作台特征正则(可选)
const PLATFORMS = [
  ['baijiahao', '百家号', 'https://baijiahao.baidu.com/builder/rc/home', ['baijiahao.baidu.com'],
    /passport\.baidu\.com|登录百度账号|扫码登录|请登录/i],
  ['toutiao', '头条号', 'https://mp.toutiao.com/profile_v4/graphic/publish', ['mp.toutiao.com'],
    /扫码登录|手机号登录|请登录/i, /发布文章|草稿|请输入正文/],
  ['zhihu', '知乎', 'https://zhuanlan.zhihu.com/write', ['zhuanlan.zhihu.com'],
    /signin|登录知乎|扫码登录/i],
  ['csdn', 'CSDN', 'https://mp.csdn.net/mp_blog/manage/article', ['mp.csdn.net'],
    /passport\.csdn\.net|请登录|扫码/i, /写文章|内容管理|草稿/],
  ['jianshu', '简书', 'https://www.jianshu.com/writer', ['jianshu.com'],
    /sign_in|登录|注册/i],
  ['bilibili', 'B站', 'https://member.bilibili.com/platform/home', ['member.bilibili.com'],
    /passport\.bilibili\.com|扫码登录|登录/i],
  ['qq', '企鹅号', 'https://om.qq.com/article/articlePublish', ['om.qq.com'],
    /扫码登录|登录|注册/i, /发布|文章|正文/],
  ['sohu', '搜狐号', 'https://mp.sohu.com/mpfe/v4/contentManagement/news/firstpagemanage', ['mp.sohu.com'],
    /passport\.sohu\.com|扫码登录|登录/i, /我的内容|发布内容|内容管理/],
  ['wangyi', '网易号', 'https://mp.163.com/article/edit', ['mp.163.com'],
    /扫码登录|登录|注册/i, /发布|文章|正文/],
  ['douyin', '抖音', 'https://creator.douyin.com/creator-micro/content/post/article', ['creator.douyin.com'],
    /扫码登录|手机号登录|登录/i, /作品发布|内容管理|文章标题/],
  ['wechat', '公众号', 'https://mp.weixin.qq.com/', ['mp.weixin.qq.com'],
    /扫码登录|请使用微信扫描|登录/i, /内容管理|草稿箱|发表记录/],
];

async function checkOne(page, spec) {
  const [, label, url, hosts, loginRe, expectRe] = spec;
  let snap = { url: '', title: '', head: '' };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await sleep(6000);
      snap = await page.evaluate(() => {
      const b = document.body ? (document.body.innerText || '') : '';
      // 验证码墙会拦住正文渲染（bodyLen 可能为 0），必须在**可见 iframe** 的 src 里查，
      // 不能全文正则匹配——页面源码里常含无关的 captcha 关键字符串（B站实测误报）。
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 10 && r.height > 10; };
      const capIframe = Array.from(document.querySelectorAll('iframe')).filter(vis)
        .some((f) => /turing\.captcha\.gtimg\.com|captcha|geetest|drag_ele/i.test(f.src || ''));
      return {
        url: location.href, title: document.title,
        head: b.replace(/\s+/g, ' ').slice(0, 200),
        captcha: capIframe,
      };
    });
  } catch (e) {
    return { ok: false, why: 'ERR ' + e.message, ...snap };
  }

  const onHost = hosts.some((h) => snap.url.includes(h));
  const looksLogin = loginRe.test(snap.head) || loginRe.test(snap.url) ||
    /passport|signin|sign_in|\/login/i.test(snap.url);

  let ok = false, why = '';
  if (snap.captcha) { ok = false; why = '触发验证码墙（滑块/点选），需人工在隔离 Chrome 里通过'; }
  else if (!onHost) { ok = false; why = '被踢离工作台域 → ' + snap.url.slice(0, 70); }
  else if (looksLogin) { ok = false; why = '页面含登录特征（需人工登录）'; }
  else {
    ok = true;
    why = '在工作台域内';
    if (expectRe && !expectRe.test(snap.head)) why += '（未匹配到工作台特征词，建议人工确认）';
  }
  return { ok, why, title: snap.title, head: snap.head, ...snap };
}

(async () => {
  const argv = process.argv.slice(2);
  const jsonOnly = argv.includes('--json');
  const wanted = argv.filter((a) => !a.startsWith('--'));
  const list = wanted.length ? PLATFORMS.filter((p) => wanted.includes(p[0])) : PLATFORMS;
  if (!list.length) { console.error('未知平台:', wanted.join(', ')); process.exit(2); }

  if (!jsonOnly) console.log('[check-login] CDP 127.0.0.1:%s，共 %d 个平台', PORT, list.length);

  // 先清掉无关标签页（含新标签页），规避僵死页把 connectOverCDP 挂死
  pk.ensureNoProxy();
  let closed = [];
  try { closed = await pk.closePagesExcept(PORT, ['about:blank', 'check-login'], true); } catch (_) {}
  if (!jsonOnly && closed.length) console.log('[check-login] 已关闭无关标签页 %d 个', closed.length);

  const { chromium } = pk.resolvePlaywright();
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 45000 });
  } catch (e) {
    console.error('ERR: 连不上隔离 Chrome（127.0.0.1:%s）。请先用 isolated-browser 启动。\n  %s', PORT, e.message);
    process.exit(3);
  }

  const ctx = (browser.contexts() && browser.contexts()[0]) || (await browser.newContext());
  let page = ctx.pages().find((p) => (p.url() || '').includes('about:blank')) || ctx.pages()[0] || (await ctx.newPage());

  const rows = [];
  for (const spec of list) {
    const r = await checkOne(page, spec);
    rows.push({ key: spec[0], label: spec[1], ...r });
    if (!jsonOnly) console.log(`${r.ok ? '✅' : '❌'} ${spec[1].padEnd(5)} ${r.why}`);
  }

  if (jsonOnly) {
    console.log(JSON.stringify(rows.map((r) => ({ key: r.key, label: r.label, ok: r.ok, why: r.why, url: r.url })), null, 2));
  } else {
    console.log('\n--- 明细 ---');
    rows.forEach((r) => {
      console.log(`\n${r.ok ? '✅' : '❌'} ${r.label} [${r.key}]  ${r.title || ''}`);
      console.log('   ' + (r.url || '').slice(0, 120));
      console.log('   ' + (r.head || '').slice(0, 110));
    });
    console.log('\n✅ 已登录: ' + (rows.filter((r) => r.ok).map((r) => r.label).join('、') || '（无）'));
    console.log('❌ 未登录: ' + (rows.filter((r) => !r.ok).map((r) => r.label).join('、') || '（无）'));
  }

  // ⚠️ 不要调 browser.close()：对 connectOverCDP 的连接，close 可能直接关掉浏览器进程，
  //    会连带杀死隔离 Chrome（后续脚本就没得用了）。这里直接退出，只断开 ws。
  process.exit(rows.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
