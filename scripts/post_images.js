#!/usr/bin/env node
/**
 * post_images.js —— 【跨 skill 共享工具】发布配图「规划」：显式指定 / 自动挑选 + 插入锚点
 *
 * 位置：isolated-browser/scripts/post_images.js
 * 由来：2026-10-12 配合「所有平台配图统一 3 张」改造新增，供全部发布类 skill 复用。
 *
 * 统一约定（所有发布 skill 一致，禁止各自发明参数）：
 *   ① `--image <path>`（可重复）→ 手动指定，按给定顺序使用（覆盖自动挑选）
 *   ② `--no-image`             → 不要配图
 *   ③ 都不给                    → 自动挑图：按「文章标签 → 素材库 pic-tag.txt」挑 Top-N 张（默认 3）
 *        · 标签来源：`--tags "a,b"`（须取自 tag.txt 原文）；缺省则由关键词自动推荐
 *        · 关键词来源：`--keyword`；缺省用文章标题
 *   ④ `--image-top <N>`        自动挑选张数（默认 3）
 *   ⑤ `--image-layout spread|group`  插入布局（默认 spread=均分到正文不同段落之间）
 *   ⑥ `--image-at <N>`         group 模式的锚点（插在第 N 段之后）
 *
 * 用法（各 skill 内）：
 *   const { planImages } = require('../../isolated-browser/scripts/post_images.js');
 *   const { images, slots } = planImages({
 *     explicit: args.image, noImage: args['no-image'], keyword: args.keyword,
 *     tags: args.tags, top: args['image-top'], layout: args['image-layout'],
 *     at: args['image-at'], dir: args['image-dir'], paraCount: PARAS.length,
 *   });
 *   // images = 绝对路径数组；slots[i] = 第 i 张图插在第几段之后（1-based）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const picker = require(path.resolve(__dirname, 'pick_images.js'));

/** 计算每张图的插入锚点（「插在第 N 段之后」，1-based；n = 正文段数） */
function computeSlots(count, paraCount, o) {
  const n = paraCount;
  if (!count || !n) return [];
  const clamp = (x) => Math.max(1, Math.min(n, x));
  const layout = (o && o.layout) === 'group' ? 'group' : 'spread';
  if (layout === 'group') {
    const at = clamp(parseInt((o && o.at) || String(Math.max(1, Math.floor(n / 2))), 10) || 1);
    return Array.from({ length: count }, () => at);
  }
  return Array.from({ length: count }, (_, i) => clamp(Math.round(((i + 1) / (count + 1)) * n)));
}

/**
 * 规划本次发布的配图。
 * @param {object} opts
 * @param {string[]|string} [opts.explicit] 显式图片路径（可重复传参收集成的数组）
 * @param {boolean} [opts.noImage]           显式声明不要配图
 * @param {string}  [opts.keyword]           自动挑图关键词（缺省由调用方传标题）
 * @param {string[]|string} [opts.tags]      文章标签（tag.txt 原文）
 * @param {number|string} [opts.top]         自动挑选张数，默认 3
 * @param {string}  [opts.layout]            spread | group
 * @param {number|string} [opts.at]          group 模式锚点
 * @param {string}  [opts.dir]               素材目录（不传则自动探测）
 * @param {string}  [opts.strategy]          exact | theme
 * @param {number}  [opts.paraCount]         正文段数（给了才算 slots）
 * @returns {{images:string[], slots:number[], source:string, detail:object|null, layout:string}}
 */
function planImages(opts) {
  const o = opts || {};
  const explicit = (o.explicit ? [].concat(o.explicit) : []).filter(Boolean).map((p) => path.resolve(p));
  let images = [];
  let source = 'auto';
  let detail = null;

  if (explicit.length) {
    explicit.forEach((p) => { if (!fs.existsSync(p)) throw new Error('配图不存在: ' + p); });
    images = explicit;
    source = 'explicit';
  } else if (o.noImage) {
    images = [];
    source = 'none';
  } else {
    const top = parseInt(o.top, 10) > 0 ? parseInt(o.top, 10) : 3;
    const keyword = String(o.keyword || '').trim();
    const tags = Array.isArray(o.tags)
      ? o.tags.map((s) => String(s).trim()).filter(Boolean)
      : String(o.tags || '').split(/[,，、|]/).map((s) => s.trim()).filter(Boolean);
    detail = picker.pickImages({ keyword, tags, top, dir: o.dir, strategy: o.strategy || 'exact' });
    images = detail.images;
    source = 'auto:' + detail.mode;
  }

  const layout = o.layout === 'group' ? 'group' : 'spread';
  const slots = o.paraCount ? computeSlots(images.length, o.paraCount, o) : [];
  return { images, slots, source, detail, layout };
}

module.exports = { planImages, computeSlots };
