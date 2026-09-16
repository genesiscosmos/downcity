/**
 * Agent Message 代码块呈现的守卫。
 *
 * ## 为什么需要这个文件
 *
 * 代码块不是 Desktop 自己写的组件，而是 Streamdown 渲染出来的 DOM（`[data-streamdown]`），
 * 由 `styles/markdown.css` 覆写。这种「别人的 DOM + 我们的样式表」最容易发生的退化是
 * 有人为了把某个角落调好看，加一条 `!important` 或者把元素挪成绝对定位的浮层——
 * 单看那一行都合理，合起来就变成一块看不清、也点不准的东西。
 *
 * 历史上就出现过这两个后果：
 *
 * 1. 容器底色是 `color-mix(muted 42%, background)`，浅色主题下几乎等于背景色；
 * 2. 元信息行被绝对定位到代码右上角，复制按钮 hover 才出现，并且压在首行右端上。
 *
 * 本文件锁住四条结论，避免它们被逐个改回去：
 *
 * - 代码的底色只有一档语义表面，不再按主题色现算；
 * - 元信息行是普通流布局，不覆盖代码区；
 * - 语言标签可见，复制按钮常显且不小于 24px；
 * - 深色语法色只保留一条真正生效的翻转规则。
 *
 * 断言源码而不是渲染结果，是因为本仓库的测试不引入 DOM 环境（见 design_token_drift）。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const renderer_root = path.join(import.meta.dirname, "../src/renderer");
const markdown_styles = fs.readFileSync(path.join(renderer_root, "styles/markdown.css"), "utf8");

/** 去掉注释：注释里会引用被禁止的写法来解释为什么禁止。 */
const styles = markdown_styles
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((line) => line.replace(/\/\/.*$/, ""))
  .join("\n");

/** 取出一个选择器的声明块；`selector` 按正则片段给出。 */
function read_rule(selector: string): string {
  const match = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`).exec(styles);
  assert.ok(match, `markdown.css 里找不到规则：${selector}`);
  return match![1]!;
}

/** 取出一个属性值；取不到即断言失败。 */
function read_declaration(rule: string, property: string, where: string): string {
  const match = new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;]+);`).exec(rule);
  assert.ok(match, `${where} 里没有声明 ${property}`);
  return match![1]!.trim();
}

/** `1.5rem` → 24；只接受 rem，px 不随界面缩放。 */
function read_rem(value: string, where: string): number {
  const match = /^([\d.]+)rem$/.exec(value);
  assert.ok(match, `${where} 的长度必须是 rem：${value}`);
  return Number(match[1]) * 16;
}

test("代码块用一档中性填充，不自己混色、不叠边框", () => {
  const rule = read_rule('\\.markdown \\[data-streamdown="code-block"\\]');
  const background = read_declaration(rule, "background", "代码块容器");
  assert.ok(background.includes("var(--surface-subtle)"), `代码块底色必须用 surface-subtle：${background}`);
  assert.ok(!/color-mix/.test(background), `饱和的 muted 会把整块染成主题色：${background}`);
  assert.ok(/^0\b/.test(read_declaration(rule, "border", "代码块容器")), "填充已能界定边界，不该再有边框");
});

test("元信息行是普通流布局，不覆盖代码区", () => {
  const rule = read_rule('\\.markdown \\[data-streamdown="code-block-header"\\]');
  assert.ok(!/position:\s*absolute/.test(rule), "元信息行被改成浮层后会被横向滚动的长行穿过");
  const display = read_declaration(rule, "display", "元信息行");
  assert.ok(display.includes("flex"), `元信息行需要一排布局：${display}`);
});

test("语言标签可见：它回答「这段是什么」", () => {
  const hidden = new RegExp('\\.markdown \\[data-streamdown="code-block-header"\\] > span:first-child\\s*\\{[^}]*display:\\s*none', "").test(styles);
  assert.ok(!hidden, "语言标签被隐藏了；围栏写了语言就必须能看到");
  const label = read_rule('\\.markdown \\[data-streamdown="code-block-header"\\] > span:first-child');
  assert.equal(read_declaration(label, "font-size", "语言标签"), "var(--text-2xs)");
  assert.equal(read_declaration(label, "color", "语言标签"), "var(--muted-foreground)");
});

test("复制按钮与消息操作栏同形：常显、尺寸、圆角、焦点环", () => {
  const rule = read_rule('\\.markdown \\[data-streamdown="code-block-copy-button"\\]');
  assert.ok(!/opacity:\s*0(?!\.)/.test(rule), "复制按钮又变成 hover 才出现了");
  assert.ok(!/pointer-events:\s*none/.test(rule), "复制按钮不该默认不可点击");
  const width = read_rem(read_declaration(rule, "width", "复制按钮"), "复制按钮宽度");
  const height = read_rem(read_declaration(rule, "height", "复制按钮"), "复制按钮高度");
  assert.ok(width >= 24 && height >= 24, `复制按钮小于 WCAG 2.2 的 24px 目标尺寸：${width}×${height}`);
  assert.equal(read_declaration(rule, "border-radius", "复制按钮"), "0.375rem", "复制按钮圆角应与图标按钮一致（rounded-md）");
  assert.ok(read_declaration(rule, "color", "复制按钮").includes("var(--muted-foreground)"), "默认色应与图标按钮一致");
});

test("复制按钮有可见的键盘焦点", () => {
  const focus_rule = read_rule('\\.markdown \\[data-streamdown="code-block-copy-button"\\]:focus-visible');
  assert.ok(read_declaration(focus_rule, "box-shadow", "复制按钮焦点").includes("var(--ring)"), "焦点环必须用 --ring 令牌");
});

test("下载按钮的隐藏是有意的，并写明了原因", () => {
  const rule = read_rule('\\.markdown \\[data-streamdown="code-block-download-button"\\]');
  assert.ok(/display:\s*none/.test(rule), "下载按钮应保持隐藏");
  assert.ok(/controls\.code/.test(markdown_styles), "隐藏下载按钮的原因（库只提供 controls.code 总开关）必须写在注释里");
});

test("深色语法色只剩一条生效的翻转规则", () => {
  assert.ok(!/\.shiki\s/.test(styles), "`.shiki` 选择器在本版本的 DOM 里不存在，是死规则");
  assert.ok(read_declaration(read_rule('\\.dark \\.markdown \\[data-streamdown="code-block-body"\\][^,]*'), "color", "深色代码色").includes("var(--shiki-dark"), "深色必须翻成 --shiki-dark（shiki 把浅色写成了行内样式）");
});
