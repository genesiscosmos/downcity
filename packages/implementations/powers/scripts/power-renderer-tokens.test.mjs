/**
 * Power Renderer 的设计令牌与侧栏结构守卫。
 *
 * ## 为什么需要它
 *
 * `Desktop/tests/design_token_drift.test.ts` 只扫 `Desktop/src/renderer`，
 * 而 **Power Renderer 是另一个包**（`packages/implementations/powers` 下的 renderer 目录）。
 * 于是那一整套收敛在 Power 里全都不成立：字号写成任意值、弱化文字叠透明度、圆角用命名档位，
 * 还有手搭的空态。
 *
 * 后果不是“不好看”，而是**同一个侧栏里出现两套字号与两套弱化程度**——
 * Messenger 的 Bot Account 列表和它自己的空态说的不是同一种视觉语言，
 * 而用户一眼就能看出“这两个不是一个东西”。
 *
 * 这份守卫把 desktop 那几条底线按同样口径套到 Power 上。
 * 断言源码而不是渲染结果：本仓库的测试不引入 DOM 环境。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const powers_root = path.join(import.meta.dirname, "../src");

/** 递归收集 Power 渲染层源码。 */
function collect_renderers(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full_path = path.join(directory, entry.name);
    if (entry.isDirectory()) return collect_renderers(full_path);
    return entry.name.endsWith(".tsx") && full_path.includes(`${path.sep}renderer${path.sep}`) ? [full_path] : [];
  });
}

/** 去掉注释，避免文档里的示例写法被当成真实代码。 */
function strip_comments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
}

/** 取出 `sidebar: function ...` 到 `mainview: function ...` 之间的一段（同一文件同时导出两个插槽）。 */
function sidebar_section(source) {
  const start = source.indexOf("sidebar: function");
  if (start === -1) return "";
  const end = source.indexOf("mainview: function", start);
  return source.slice(start, end === -1 ? undefined : end);
}

/** 禁止出现的写法与禁止理由；与 desktop 的 design_token_drift 同口径。 */
const banned = [
  { rule: /text-\[\d+px\]/, why: "固定 px 字号不跟随界面缩放；用语义字号档位（text-3xs … text-3xl）" },
  { rule: /text-\[[^\]]*(?:rem|px|em|pt|ch|ex|vh|vw|calc\()/, why: "字号只能取语义档位；要新档位先在 tokens.css 定义" },
  { rule: /text-muted-foreground\/\d/, why: "次要文字只有一档；用 text-muted-foreground 或 text-subtle-foreground" },
  { rule: /text-foreground\/\d/, why: "正文只有一档；不要再叠透明度" },
  { rule: /bg-foreground\/\[/, why: "中性表面用 bg-surface-subtle / bg-surface-emphasis" },
  { rule: /border-border\/\d/, why: "描边只用 border-border / border-divider / border-border-subtle" },
  { rule: /\brounded-(?:sm|md|lg|xl|2xl|3xl)\b/, why: "圆角用角色名（chip / control / item / surface / shell / avatar / tile）" },
  { rule: /\bshadow-xl\b/, why: "阴影只有浮层（shadow-lg）与模态（shadow-2xl）两级" },
];

test("Power Renderer 不出现被收敛掉的令牌写法", () => {
  const violations = [];
  for (const file of collect_renderers(powers_root)) {
    const relative = path.relative(powers_root, file);
    strip_comments(fs.readFileSync(file, "utf8")).split("\n").forEach((line, index) => {
      for (const { rule, why } of banned) {
        if (rule.test(line)) violations.push(`${relative}:${index + 1} ${rule} → ${why}\n    ${line.trim().slice(0, 120)}`);
      }
    });
  }
  assert.deepEqual(violations, [], `Power Renderer 发现 ${violations.length} 处令牌漂移：\n  ${violations.join("\n  ")}`);
});

/**
 * 侧栏的行必须用宿主的行组件。
 *
 * 自己拼 `<div>` + `min-h-*` 就等于长出了第二套行高与内边距，
 * 而那正是 desktop 侧栏刚收敛掉的东西。
 */
test("Power 侧栏的行只用注入的行组件", () => {
  const violations = [];
  for (const file of collect_renderers(powers_root)) {
    const source = strip_comments(fs.readFileSync(file, "utf8"));
    const sidebar = sidebar_section(source);
    if (!sidebar) continue;
    const relative = path.relative(powers_root, file);
    for (const match of sidebar.matchAll(/className="[^"]*\bmin-h-(?:7|8|9|10|11|12)\b[^"]*"/g)) {
      violations.push(`${relative} → ${match[0]}`);
    }
  }
  assert.deepEqual(violations, [], `Power 侧栏自己写了行高，请改用 SidebarItem / SidebarTreeItem：\n  ${violations.join("\n  ")}`);
});

/**
 * 侧栏里的“行外副文本”必须走宿主组件 `SidebarSubText`。
 *
 * 这条不是风格偏好：副文本的左缘要对齐到同级行的文字线，字号与颜色要取宿主令牌。
 * 自己拼一个 `<div>` 时这三件事都会各自决定——三个不同的左内边距就是这么来的，
 * 而它们各自“看起来都对”，只因为它们分别对齐了不同的东西。
 */
test("侧栏的副文本走宿主注入的 SidebarSubText", () => {
  const violations = [];
  for (const file of collect_renderers(powers_root)) {
    const source = strip_comments(fs.readFileSync(file, "utf8"));
    const sidebar = sidebar_section(source);
    if (!sidebar) continue;
    const relative = path.relative(powers_root, file);
    // 副文本的识别特征：小字号（2xs / 3xs）+ 弱化色，且是裸 <div>。
    for (const match of sidebar.matchAll(/<div className="[^"]*(?:text-2xs|text-3xs)[^"]*"/g)) {
      violations.push(`${relative} → ${match[0].slice(0, 100)}`);
    }
  }
  assert.deepEqual(violations, [], `侧栏里出现了手搭的副文本，请改用 SidebarSubText：\n  ${violations.join("\n  ")}`);
});
