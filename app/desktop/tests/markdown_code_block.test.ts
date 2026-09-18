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
  /*
   * 圆角改成角色令牌后，断言从「字面量等于 0.375rem」改成「取 --radius-control」，
   * 并**交叉核对角色值确实等于图标按钮用的 rounded-md**。
   * 原始意图是「与消息操作栏的图标按钮同形」，那个意图没变，只是两侧现在
   * 一个用工具类（rounded-md）、一个用 CSS 令牌（var），需要显式verify 两者等值。
   */
  assert.equal(
    read_declaration(rule, "border-radius", "复制按钮"),
    "var(--radius-control)",
    "复制按钮圆角应取角色令牌 --radius-control",
  );
  const control_value = /--radius-control:\s*([^;]+);/.exec(fs.readFileSync(path.join(renderer_root, "styles/tokens.css"), "utf8"));
  assert.equal(
    control_value?.[1]?.trim(),
    "0.375rem",
    "--radius-control 不再是 0.375rem：复制按钮会与消息操作栏的图标按钮（rounded-md）不一致",
  );
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

/**
 * 行号必须被显式关闭。
 *
 * 库用 CSS 计数器把行号画在行 `span` 的伪元素上，而那些类名写在 `node_modules` 里。
 * 曾经的结论是「不会生成，所以不用关」——**那个结论错过了一件事**：
 * Tailwind 的自动源检测从**仓库根**开始，`.md` 也算源文件，
 * 因此只要任何一个文档/测试/注释里出现那个类名的字面写法，内容那一半就会被生成，
 * 而自增那一半（只在 `node_modules` 里）仍然不会——结果就是**每一行前面都是 0**。
 *
 * 这不是推测：`docs/desktop-agent-message-rendering-redesign-prd.md` 曾把它当例子写进正文，
 * 于是真的出现了这个现象（同时抑制规则被删了）。下面两条断言把两个前提都钉住：
 * 一、样式表里必须有抑制规则；二、不能让那个类名从别处泄漏进去。
 */
test("行号槽被显式关闭，且不依赖「那个类不会生成」", () => {
  const rule = read_rule('\\.markdown \\[data-streamdown="code-block-body"\\] code > span::before');
  assert.ok(
    /content:\s*none\s*!important/.test(rule),
    "行号槽没有被关闭：库的伪元素行号会直接显示出来。\n"
      + "不要删除这条规则，也不要把它改成依赖「那些类不会被扫描」的说明。",
  );
});

/**
 * 那个会打开行号的类名不得从任何被扫描的文件里泄漏进来。
 *
 * Tailwind 的自动源检测从**仓库根**开始（不是从 `app/desktop`），除了被 `.gitignore` 排除的
 * 东西之外，`.md` / `.ts` / `.json` 都是源文件。所以一行文档、一个测试里的字面类名，
 * 就能让 Tailwind 真的生成对应的 CSS。
 *
 * 本项目已经撞过一次：一个 PRD 正文里把这个类名当例子写了出来，于是 `content` 那一半被生成，
 * 而自增那一半只在 `node_modules` 里、仍然不生成——**每行前面都变成 0**。
 *
 * 要说明这些类名时，写在**CSS 注释**里（CSS 不参与源扫描），那个位置既安全又能被找到。
 */
test("代码块行号的类名没有泄漏进被扫描的文件", () => {
  // 与 Tailwind 一致：向上找到含 .git 的目录作为仓库根。
  let repo_root = import.meta.dirname;
  while (!fs.existsSync(path.join(repo_root, ".git"))) {
    const parent = path.dirname(repo_root);
    assert.notEqual(parent, repo_root, "找不到仓库根（没有 .git）——本测试的扫描范围无法确定");
    repo_root = parent;
  }

  /**
   * 构建要搜的字符串：**必须把片段拼起来**，不能直接写完整字面量。
   *
   * 这里有两条互相牵制的约束，很容易写错：
   *
   * 1. 要抓的是 Tailwind **实际能抽取的子串**，而不是完整类名。
   *    完整类名带 `before:` 前缀与方括号，但扫描器从文本里抽出来的是中间那一段属性写法；
   *    只比完整类名会漏报。
   * 2. 本文件自己也是被扫描的 `.ts` 文件。危险子串只要在文件里**连续出现一次**——
   *    包括写在注释里当例子——这层守卫就变成新的泄露源。
   *
   * 所以切片点选在子串内部，让危险片段在文件里始终被引号或逗号隔开。
   * 这也是为什么不在此处的注释里直接把那段属性写法写出来：说明它只能用
   *「属性名 + 计数器名」这种拆开的方式描述。
   */
  const piece = (...fragments: string[]) => fragments.join("");
  const leaking_tokens = [
    piece("counter", "(line)"),
    piece("counter", "-increment", ":line"),
    piece("counter", "-reset", ":line"),
    piece("line", "_0"),
  ];
  const skip_dirs = new Set([".git", "node_modules", "out", "build", ".pnpm-store", "dist"]);
  /** 会被 Tailwind 当作源文件扫描的文本类型（CSS 不在内，因此可以在 CSS 注释里写说明）。 */
  const scanned_extensions = /\.(?:md|mdx|tsx?|jsx?|mjs|cjs|json|html|ya?ml|txt|sh)$/;

  const offenders: string[] = [];
  let scanned_files = 0;
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skip_dirs.has(entry.name)) walk(path.join(directory, entry.name));
        continue;
      }
      // CSS 不参与源扫描，可以安全地用它写说明。
      if (entry.name.endsWith(".css")) continue;
      if (!scanned_extensions.test(entry.name)) continue;
      const file = path.join(directory, entry.name);
      const content = fs.readFileSync(file, "utf8");
      scanned_files += 1;
      for (const token of leaking_tokens) {
        if (content.includes(token)) offenders.push(`${path.relative(repo_root, file)} 含「${token}」`);
      }
    }
  };
  walk(repo_root);

  assert.ok(scanned_files > 500, `只扫到 ${scanned_files} 个文件，扫描范围可能已失效`);
  assert.deepEqual(
    offenders,
    [],
    `以下文件写了会生成代码块行号的类名，请改成 CSS 注释里描述，或换个写法：\n  ${offenders.join("\n  ")}\n`
      + "（这些字面量会让 Tailwind 生成行号 CSS；而自增那一半在 node_modules 里不生成，结果每行都显示 0）",
  );
});
