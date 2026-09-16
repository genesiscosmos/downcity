/**
 * 校验 Tailwind 令牌映射真的产出了工具类。
 *
 * 为什么需要它：`tokens.css` 用 `@theme inline` 把 `--color-*` 映射到 `semantic-colors.css`
 * 的语义令牌上。如果某个映射漏写或写错，`text-subtle-foreground`、`bg-scrim-strong`
 * 这类类名会**静默地什么都不生成**——TypeScript 检查不到，单测也检查不到，
 * 只会表现为「某个元素看起来没上色」。本批集中引入了 6 个新令牌，必须验证。
 *
 * 做法：用 Tailwind 的编程式 API 编译应用真实的样式入口，只喂入待验证的候选类名，
 * 断言输出里存在对应的声明。比跑完整 electron-vite 构建轻得多（后者需要 2GB+ 内存）。
 *
 * 注意 `@theme inline` 的语义：它把令牌的**值**直接内联进工具类。
 * 所以 `--color-subtle-foreground: var(--subtle-foreground)` 产出 `color: var(--subtle-foreground)`，
 * 而 `--radius-floating-surface: var(--radius-xl)` 产出的是 `border-radius: var(--radius-xl)`
 * ——不是 `var(--radius-floating-surface)`。断言必须按「实际声明」写，而不是按类名与令牌同名写。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { compile } from "tailwindcss";

const renderer_root = path.join(import.meta.dirname, "../src/renderer");
const styles_root = path.join(renderer_root, "styles");

/** 定位 tailwindcss 包根：`import.meta.resolve` 给的是 dist/lib.mjs，需要往上找到含 index.css 的那一层。 */
function resolve_tailwind_root(): string {
  let current = path.dirname(import.meta.resolve("tailwindcss").replace("file://", ""));
  while (!fs.existsSync(path.join(current, "index.css"))) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error("无法定位 tailwindcss 包根");
    current = parent;
  }
  return current;
}

const tailwind_root = resolve_tailwind_root();

/** 把 CSS 入口及其 @import 解析成 Tailwind 可以编译的源。 */
async function compile_app_styles() {
  const entry = path.join(styles_root, "base.css");
  const compiler = await compile(fs.readFileSync(entry, "utf8"), {
    base: path.dirname(entry),
    loadStylesheet: async (id: string, from: string) => {
      // `@import "tailwindcss"` 解析到包自身的 index.css；其余按相对路径解析。
      const resolved = id === "tailwindcss"
        ? path.join(tailwind_root, "index.css")
        : path.resolve(from, id.startsWith(".") ? id : `${id}.css`);
      if (!fs.existsSync(resolved)) throw new Error(`无法解析样式表：${id}（来自 ${from}）`);
      return { path: resolved, base: path.dirname(resolved), content: fs.readFileSync(resolved, "utf8") };
    },
  });
  return compiler;
}

/** 需要产出的类名 → 期望出现在该规则块里的声明片段。 */
const expected: readonly [string, string][] = [
  ["text-subtle-foreground", "color: var(--subtle-foreground)"],
  // 语义字号（--text-size-*）的可生成性由 `font_scale.test.ts` 负责：
  // 它不但确认 9 级都产出规则，还确认旧的 text-xs/text-sm/text-base 一个都不产出。
  ["bg-control-track", "background-color: var(--control-track)"],
  ["bg-control-surface", "background-color: var(--control-surface)"],
  ["bg-control-hover", "background-color: var(--control-hover)"],
  ["bg-surface-brand", "background-color: var(--surface-brand)"],
  ["bg-surface-subtle", "background-color: var(--surface-subtle)"],
  ["bg-surface-emphasis", "background-color: var(--surface-emphasis)"],
  ["bg-interaction-hover", "background-color: var(--interaction-hover)"],
  ["bg-interaction-active", "background-color: var(--interaction-active)"],
  ["bg-interaction-selected", "background-color: var(--interaction-selected)"],
  ["bg-scrim", "background-color: var(--scrim)"],
  ["bg-scrim-strong", "background-color: var(--scrim-strong)"],
  ["border-divider", "var(--divider)"],
  ["border-border-subtle", "var(--border-subtle)"],
  ["divide-divider", "var(--divider)"],
  // 这两条的 `inline` 映射内联到主题基础值，因此断言的是内联后的结果。
  ["rounded-floating-surface", "border-radius: var(--radius-xl)"],
  ["rounded-floating-item", "border-radius: var(--radius-lg)"],
];

/**
 * 判断一个类名对应的规则块里是否包含指定声明。
 *
 * 不做完整 CSS 解析：产物里存在 CSS 嵌套（`.divide-divider { :where(& > …) { … } }`）
 * 与选择器转义（`.hover\:bg-x` 里的反斜杠），用完整选择器正则很容易误判。
 * 这里先去掉转义反斜杠再按「类名 + 词边界」定位，并在其后一段窗口内查声明。
 */
function has_declaration(css: string, class_name: string, fragment: string): boolean {
  const normalized = css.replace(/\\/g, "");
  const needle = `.${class_name}`;
  for (let index = normalized.indexOf(needle); index !== -1; index = normalized.indexOf(needle, index + 1)) {
    const boundary = normalized[index + needle.length];
    // 避免 `.bg-scrim` 误匹配 `.bg-scrim-strong`。
    if (boundary !== undefined && /[\w-]/.test(boundary)) continue;
    if (normalized.slice(index, index + 400).includes(fragment)) return true;
  }
  return false;
}

test("本批新增与沿用的语义令牌都能生成工具类", async () => {
  const compiler = await compile_app_styles();
  const css = compiler.build(expected.map(([class_name]) => class_name));

  const missing = expected
    .filter(([class_name, declaration]) => !has_declaration(css, class_name, declaration))
    .map(([class_name, declaration]) => `${class_name} 期望含「${declaration}」`);

  assert.deepEqual(missing, [], `以下类名没有生成预期声明：\n  ${missing.join("\n  ")}`);
});

test("未定义的令牌不会意外生成类名", async () => {
  const compiler = await compile_app_styles();
  // 反向确认：拼错的类名不得生成规则，否则上一条断言可能是假阳性。
  // `build()` 总会返回 prelude（主题层与 preflight），因此只能针对具体类名断言，
  // 不能整体比较输出。
  const css = compiler.build(["text-subtle-foreground-typo", "text-subtle-foreground"]);
  assert.ok(!has_declaration(css, "text-subtle-foreground-typo", "color:"), "拼错的类名竟然生成了规则");
  assert.ok(has_declaration(css, "text-subtle-foreground", "color: var(--subtle-foreground)"), "正确类名应当生成规则，否则本测试无法证明任何事");
});

/** 本批大量依赖的这些变体组合必须真实产出，否则交互态会静默失效。 */
const expected_variants: readonly [string, string][] = [
  ["hover:bg-interaction-hover", "background-color"],
  ["hover:bg-interaction-active", "background-color"],
  ["focus-visible:bg-interaction-hover", "background-color"],
  ["group-hover:bg-muted-foreground", "background-color"],
  // 具名 group：Agent 身份行的悬停下划线只在鼠标落在头像+名称上时出现，
  // 用无名 group 会让悬停正文也下划线。变体不产出时它只是静默失效（看不出错）。
  ["group-hover/identity:underline", "text-decoration-line: underline"],
  ["focus-visible:ring-ring/30", "--tw-ring-color"],
  ["divide-divider", "border-color: var(--divider)"],
  ["divide-border-subtle", "border-color: var(--border-subtle)"],
];

test("交互态变体组合能真实产出声明", async () => {
  const compiler = await compile_app_styles();
  const css = compiler.build(expected_variants.map(([class_name]) => class_name));
  const missing = expected_variants
    .filter(([class_name, fragment]) => !has_declaration(css, class_name, fragment))
    .map(([class_name]) => class_name);
  assert.deepEqual(missing, [], `以下变体没有生成预期声明：${missing.join(", ")}`);
});

test("语义令牌层为每套主题都提供了取值", () => {
  const tokens = fs.readFileSync(path.join(styles_root, "tokens.css"), "utf8");
  const semantic = fs.readFileSync(path.join(styles_root, "semantic-colors.css"), "utf8");
  // tokens.css 里出现的每个 --color-* 都必须能在 semantic-colors.css 找到同名令牌定义，
  // 否则就是「声明了映射但没有取值」，表现得和漏写类名一样。
  const mapped = [...tokens.matchAll(/--color-([a-z0-9-]+):\s*var\(--([a-z0-9-]+)\)/g)];
  assert.ok(mapped.length >= 20, `只解析到 ${mapped.length} 条映射，解析方式可能已失效`);
  const undefined_tokens = mapped
    .filter(([, , token]) => !new RegExp(`--${token}:`).test(semantic) && !new RegExp(`--${token}:`).test(fs.readFileSync(path.join(styles_root, "theme/default.css"), "utf8")))
    .map(([, , token]) => token);
  assert.deepEqual(undefined_tokens, [], `tokens.css 引用了没有取值的令牌：${undefined_tokens.join(", ")}`);
});
