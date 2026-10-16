#!/usr/bin/env node
/**
 * pick_images.js —— 【跨 skill 共享工具】按「文章标签 → 素材库」挑出最相关的 N 张配图（默认 3 张）
 *
 * 位置：isolated-browser/scripts/pick_images.js
 * 由来：2026-10-12 从 baijiahao-publish-skill 提升为共享工具，供全部发布类 skill 复用。
 *       两个文件同源；改动请同步两边（或只改本文件，百家号那份为历史兼容副本）。
 *
 * 各 skill 引用方式（相对路径，不要写死盘符/用户名）：
 *   const { pickImages } = require('../../isolated-browser/scripts/pick_images.js');
 *   const r = pickImages({ keyword: '婚车', tags: ['婚庆用车','婚庆婚车车队'], top: 3 });
 *   // r.images = ['<素材库>/14.jpg', ...]  → 直接拿去发布
 *
 * 挑选口径（用户既定要求）：
 *   ① 先从 `tag.txt` 找出该文章的标签（可多个；不传 tags 时按 keyword 自动推荐）
 *   ② 再用这些标签去 `pic-tag.txt` 里挑**最匹配的三张**作为文章配图
 *
 * 用法：
 *   node scripts/pick_images.js --keyword 婚车 --tags "婚庆用车,婚庆婚车车队" [--top 3] [--json]
 *   node scripts/pick_images.js --keyword 婚车 --suggest-tags          # 只从 tag.txt 推荐文章标签
 *   node scripts/pick_images.js --keyword 婚车 --pick 11,9,14          # 人工指定（复核后覆盖）
 *   node scripts/pick_images.js --keyword 婚车 --strategy theme         # 排序改「主题贴合优先」
 *   node scripts/pick_images.js --tags-file args.json                  # 中文参数从 UTF-8 文件读，避开终端编码
 *
 * 素材目录解析顺序（不写死路径/盘符）：
 *   --dir → PUBLISH_IMAGE_DIR → <本文件>/../../car（= skills 根旁的 car）→ ~/car → ./car
 *
 * 打分（默认 strategy=exact，依次比较，高者在前）：
 *   1) tagScore   文章标签在图片标签块内的**字面命中数**（最可靠）
 *   2) nameHit    关键词是否出现在图片**名称**里（如「婚嫁专属婚车车队」命中「婚车」）
 *   3) phraseScore 文章标签与图片短语的最优相似度之和（2-gram 覆盖 + 单字覆盖，0~3/标签）
 *   4) themeHits  关键词切出的 2-gram 在块内出现**次数**（主题贴近度）
 *   strategy=theme 时改为 phraseScore 优先，适合「尽量相关」的诉求。
 *
 * ⚠️ 字面命中可能是「通用素材」而非主题画面（2026-09-29 婚车案例：图14 字面命中两个标签，
 *    但图11「宾利婚车/鲜花装饰/爱心气球」主题更贴）。因此：**结果必须看图复核**，
 *    不符时用 `--pick N,M,K` 覆盖；默认 Top3 也正是为了留出这种余地。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const norm = s => (s || '').replace(/[\s\u3000]/g, '');

// ── 素材目录：不写死，按 --dir / 环境变量 / 常见位置依次探测 ──
function resolveImageDir(explicit) {
  if (explicit) return explicit;
  if (process.env.PUBLISH_IMAGE_DIR) return process.env.PUBLISH_IMAGE_DIR;
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const cands = [
    path.resolve(__dirname, '..', '..', 'car'),   // 素材目录（skills 根旁的 car）
    home && path.join(home, 'car'),
    path.join(process.cwd(), 'car'),
  ].filter(Boolean);
  for (const c of cands) {
    try { if (fs.statSync(c).isDirectory()) return c; } catch (e) { /* next */ }
  }
  return cands[0];
}

// ── 解析 pic-tag.txt（## 图 N（名称） 分块；兼容 # / ### 标题层级） ──
function loadPicBlocks(dir, picFile) {
  const f = path.join(dir, picFile || 'pic-tag.txt');
  if (!fs.existsSync(f)) throw new Error('未找到图片标签库: ' + f);
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^#{1,3}\s*图\s*(\d+)\s*(?:[（(](.*?)[）)])?/);
    if (m) { cur = { n: parseInt(m[1], 10), name: (m[2] || '').trim(), raw: line }; blocks.push(cur); continue; }
    if (cur) cur.raw += '\n' + line;
  }
  if (!blocks.length) throw new Error('pic-tag.txt 解析为空（需要 "## 图 N（名称）" 形式的标题）: ' + f);
  return blocks;
}

// ── 解析 tag.txt（### 分组 + 一行多个标签，、/, 分隔） ──
function loadTags(dir, tagFile) {
  const f = path.join(dir, tagFile || 'tag.txt');
  const out = [];
  if (!fs.existsSync(f)) return out;
  let group = '';
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const g = t.match(/^#{1,3}\s*(.+)$/);
    if (g) { group = g[1].trim(); continue; }
    t.split(/[、,，|]/).map(s => s.trim()).filter(Boolean).forEach(tag => out.push({ tag, group }));
  }
  return out;
}

// ── 编号 → 图片文件 ──
function imageMap(dir) {
  const byNum = {};
  let files = [];
  try { files = fs.readdirSync(dir); } catch (e) { return byNum; }
  files.filter(f => /^\d+\.(jpe?g|png|webp)$/i.test(f))
    .forEach(f => { byNum[parseInt(f, 10)] = path.join(dir, f); });
  return byNum;
}

function bigrams(s) {
  const k = norm(s), out = [];
  for (let i = 0; i + 2 <= k.length; i++) { const g = k.slice(i, i + 2); if (!out.includes(g)) out.push(g); }
  return out;
}
function uniqChars(s) { return Array.from(new Set(Array.from(norm(s)))); }
const countOccur = (text, sub) => { let c = 0, i = 0; while ((i = text.indexOf(sub, i)) !== -1) { c++; i += sub.length; } return c; };

// ── 短语级相似度：解决「标签既没字面命中、关键词也切不出 gram」时退化成盲选的问题 ──
// 图片块里的标签是「业务标签：A、B、C」这类短语；把文章标签逐条与图片短语比：
//   完全相同 5 分 / 互相包含 4 分 / 否则 2×(2-gram 覆盖率) + 单字覆盖率（0~3）
function phraseSim(t, p) {
  if (!t || !p) return 0;
  if (p === t) return 5;
  if (p.includes(t) || t.includes(p)) return 4;
  const tb = bigrams(t);
  const bo = tb.length ? tb.filter(g => p.includes(g)).length / tb.length : 0;
  const tc = uniqChars(t), pc = uniqChars(p);
  const co = tc.length ? tc.filter(c => pc.includes(c)).length / tc.length : 0;
  return 2 * bo + co;
}
// 从图片块抽短语：按分隔符切，剥掉「业务标签：」这类前缀，丢掉空/超长片段
function extractPhrases(raw) {
  return String(raw || '')
    .split(/[\n、,，|:：;；]/)
    .map(s => norm(s).replace(/^(业务标签|内容标签|属性标签|标签)/, ''))
    .filter(s => s && s.length <= 12);
}
// 文章标签逐一取「与图片短语的最优相似度」再求和（求和避免只命中一个标签就并列）
function phraseScoreOf(tags, phrases) {
  let sum = 0;
  for (const t of tags) {
    const nt = norm(t);
    let best = 0;
    for (const p of phrases) { const s = phraseSim(nt, p); if (s > best) best = s; }
    sum += best;
  }
  return Math.round(sum * 100) / 100;
}

// ── 从 tag.txt 里为文章推荐标签（关键词 → 标签库中的合法标签） ──
// 中文 2-gram 在短关键词上区分度不足（"婚车"只有 1 个 gram），故用「单字覆盖 + 2-gram 覆盖 + 子串」三段打分：
//   子串：标签===关键词 +10 / 关键词含标签 +4 / 标签含关键词 +3
//   charOverlap  ：关键词的单字被标签覆盖的比例 × 3
//   bigramOverlap：关键词的 2-gram 被标签覆盖的比例 × 3
// 过滤：score < 2 视为不相关丢掉；若过滤后不足 2 个，则退化为「不过滤的前 3 名」。
function suggestTags(keyword, allTags, top) {
  const k = norm(keyword);
  if (!k || !allTags.length) return [];
  const kb = bigrams(k);
  const kChars = Array.from(new Set(Array.from(k)));
  const all = allTags.map(({ tag, group }) => {
    const t = norm(tag);
    let score = 0;
    if (t && t === k) score += 10;
    else if (k.includes(t)) score += 4;
    else if (t.includes(k)) score += 3;
    const charOverlap = kChars.length ? kChars.filter(c => t.includes(c)).length / kChars.length : 0;
    const bigramOverlap = kb.length ? kb.filter(g => t.includes(g)).length / kb.length : 0;
    score += charOverlap * 3 + bigramOverlap * 3;
    return { tag, group, score: Math.round(score * 100) / 100 };
  }).filter(s => s.score > 0);

  all.sort((a, b) => b.score - a.score || a.tag.length - b.tag.length);
  let picked = all.filter(s => s.score >= 2);
  if (picked.length < 2) picked = all.slice(0, 3);
  return picked.slice(0, top || 5);
}

// ── 主匹配：返回最相关的前 N 张 ──
function pickImages(opt) {
  const o = opt || {};
  const dir = resolveImageDir(o.dir);
  const top = parseInt(o.top, 10) > 0 ? parseInt(o.top, 10) : 3;
  const keyword = (o.keyword || '').toString().trim();
  const allTags = loadTags(dir, o.tagFile);
  let tags = (o.tags || []).map(s => String(s).trim()).filter(Boolean);
  let tagsAuto = false;

  if (!tags.length && keyword) {                       // 没给标签 → 用 tag.txt 自动推荐前 3 个
    tags = suggestTags(keyword, allTags, 3).map(s => s.tag);
    tagsAuto = tags.length > 0;
  }

  const blocks = loadPicBlocks(dir, o.picFile);
  const byNum = imageMap(dir);
  const themeTokens = bigrams(keyword);
  const strategy = o.strategy === 'theme' ? 'theme' : 'exact';

  const scored = blocks.map(b => {
    const blob = norm(b.raw);
    const hits = tags.filter(t => blob.includes(norm(t)));
    const nameHit = keyword ? norm(b.name).includes(norm(keyword)) : false;
    const themeHits = themeTokens.reduce((s, g) => s + countOccur(blob, g), 0);
    const phraseScore = phraseScoreOf(tags, extractPhrases(b.raw));
    return { n: b.n, name: b.name, tagScore: hits.length, matches: hits, nameHit, themeHits, phraseScore, image: byNum[b.n] || null };
  }).filter(s => s.image);

  if (!scored.length) throw new Error('素材库中没有与图片编号对应的图片文件（' + dir + '）');

  // 排序键：exact = 标签字面命中优先（沿用旧 pick_image.js 口径）；
  //        theme = 短语相似度优先（主题贴合优先，适合「尽量相关」的诉求）
  const nh = s => (s.nameHit ? 1 : 0);
  scored.sort(strategy === 'theme'
    ? (a, b) => b.phraseScore - a.phraseScore || nh(b) - nh(a) || b.tagScore - a.tagScore || b.themeHits - a.themeHits || a.n - b.n
    : (a, b) => b.tagScore - a.tagScore || nh(b) - nh(a) || b.phraseScore - a.phraseScore || b.themeHits - a.themeHits || a.n - b.n);

  // 人工指定优先
  const pick = (o.pick || []).map(x => parseInt(x, 10)).filter(Boolean);
  let chosen, mode;
  if (pick.length) {
    chosen = pick.map(n => scored.find(s => s.n === n)).filter(Boolean);
    mode = 'manual';
  } else {
    chosen = scored.slice(0, top);
    mode = scored[0].tagScore > 0 ? 'tag' : (scored[0].nameHit || scored[0].phraseScore > 1 ? 'theme' : 'fallback');
  }

  return {
    dir,
    mode,                                            // tag=标签字面命中 | theme=关键词/短语贴近 | fallback=无匹配按编号取前N | manual=--pick 指定
    strategy,
    tags,
    tagsAuto,                                        // 标签是否由关键词自动推荐得来
    keyword: keyword || null,
    top,
    images: chosen.map(s => s.image),                // 供发布脚本直接使用
    chosen: chosen.map(s => ({
      number: s.n, name: s.name, tagScore: s.tagScore, matches: s.matches,
      nameHit: s.nameHit, themeHits: s.themeHits, phraseScore: s.phraseScore, image: s.image
    })),
    ranking: scored.slice(0, 8).map(s => ({ n: s.n, name: s.name, tagScore: s.tagScore, nameHit: s.nameHit, themeHits: s.themeHits, phraseScore: s.phraseScore, matches: s.matches })),
    note: '字面命中的候选可能是通用素材；请看图复核主题一致性，不符时用 --pick N,M,K 覆盖'
  };
}

module.exports = { pickImages, suggestTags, resolveImageDir, loadPicBlocks, loadTags };

// ─────────────────────────── CLI ───────────────────────────
if (require.main === module) {
  const A = process.argv.slice(2);
  const arg = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
  const flag = k => A.includes(k);

  let keyword = arg('--keyword', '');
  let tagsRaw = arg('--tags', '');
  let dir = arg('--dir', '');

  // 中文参数走终端易乱码：允许从 UTF-8 JSON 文件读（{keyword, tags:[], dir, top, pick:[]}）
  const tagsFile = arg('--tags-file', '');
  let cfg = {};
  if (tagsFile && fs.existsSync(tagsFile)) {
    try { cfg = JSON.parse(fs.readFileSync(tagsFile, 'utf8')); }
    catch (e) { console.error('❌ --tags-file 解析失败: ' + e.message); process.exit(1); }
    keyword = cfg.keyword || keyword;
    dir = cfg.dir || dir;
    if (Array.isArray(cfg.tags)) tagsRaw = cfg.tags.join(',');
  }

  const TAGS = (tagsRaw || '').split(/[,，、|]/).map(s => s.trim()).filter(Boolean);
  const TOP = parseInt(arg('--top', '3'), 10) || 3;
  const PICK = (arg('--pick', '') || (cfg.pick || []).join(',')).split(/[,，\s]+/).map(s => parseInt(s, 10)).filter(Boolean);

  try {
    if (flag('--suggest-tags')) {
      const d = resolveImageDir(dir);
      const all = loadTags(d);
      const sug = suggestTags(keyword || TAGS.join(''), all, TOP);
      if (flag('--json')) { console.log(JSON.stringify({ dir: d, keyword, suggestions: sug }, null, 2)); }
      else {
        console.log('素材目录:', d);
        console.log('关键词:', keyword || '(空)');
        console.log('tag.txt 推荐标签（前 ' + sug.length + '）:');
        sug.forEach((s, i) => console.log('  ' + (i + 1) + ') ' + s.tag + '  [' + s.group + ']  score=' + s.score));
        console.log('提示: 标签须为 tag.txt 中的原文，选好后传给 --tags');
      }
      process.exit(0);
    }

    const r = pickImages({ tags: TAGS, keyword, top: TOP, dir, pick: PICK, strategy: arg('--strategy', 'exact') });
    if (flag('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }

    const MODE = { tag: '标签字面命中', theme: '关键词/短语贴近', fallback: '无命中 → 按编号取前 N', manual: '人工指定（--pick）' }[r.mode];
    console.log('素材目录:', r.dir);
    console.log('标签:', r.tags.length ? r.tags.join('、') + (r.tagsAuto ? '（由关键词自动推荐）' : '') : '(未提供)', '| 关键词:', r.keyword || '(空)');
    console.log('匹配模式:', MODE, '| 排序策略:', r.strategy === 'theme' ? '主题贴合优先' : '标签字面优先');
    console.log('选中 ' + r.chosen.length + ' 张:');
    r.chosen.forEach((c, i) => {
      console.log('  ' + (i + 1) + ') 图' + c.number + (c.name ? '（' + c.name + '）' : '') +
        ' 标签命中 ' + c.tagScore + (c.matches.length ? '（' + c.matches.join('、') + '）' : '') +
        ' | 名称命中 ' + (c.nameHit ? '是' : '否') + ' | 短语 ' + c.phraseScore + ' | 主题词 ' + c.themeHits);
      console.log('     ' + c.image);
    });
    console.log('候选前 8:', r.ranking.map(s => '图' + s.n + '[标签' + s.tagScore + '/名称' + (s.nameHit ? 1 : 0) + '/短语' + s.phraseScore + ']').join(' > '));
    console.log('提示:', r.note);
  } catch (e) {
    console.error('❌ ' + e.message);
    process.exit(1);
  }
}
