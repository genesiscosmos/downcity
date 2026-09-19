/**
 * Markdown 垂直节奏的守卫。
 *
 * ## 为什么需要这个文件
 *
 * 块间距不是一次定下来的，而是逐条加上去的：代码块 0.7em、图表 0.75em、图片 0.8em、
 * 公式 0.9em、表格与分隔线 1em、标题上方 1.1em。每一条单看都合理，
 * 合起来是同一条消息里同时出现 7.5px 与 25.6px——最大的比最小的大两倍多。
 *
 * 更隐蔽的一半来自**库**：Streamdown 在根节点写 `space-y-4`（1rem）、
 * 在列表项写 `py-1`、在图片容器写 `my-4`。它们不报错、不在本仓库里、也不显眼，
 * 但会静默加进已经声明过的节奏：列表项因此比段落还松，表格与图片因此拿到 16px。
 *
 * 现在只有三个间距档（`markdown.css` 的 `--markdown-*` 令牌）+ 一对标题外边距。
 * 本文件锁住四件事：
 *
 * 1. 三档存在、取值固定、大小关系成立（紧 < 正文 < 块级），且没有第四档；
 * 2. 两个文档方言样式表（`markdown.css` / `mermaid.css`）不得再出现字面量 em 外边距——
 *    新加块级元素只能复用已有的档，不能就地拍一个「看着差不多」的值；
 * 3. 库自带的三处间距都被显式压掉（根节点、列表项、图片容器）；
 * 4. 块级表面用的是块级档，不是正文档。
 *
 * 断言源码而不是渲染结果，是因为本仓库的测试不引入 DOM 环境（见 design_token_drift）。
 * 「类名在浏览器里是否真的生效」由 `tailwind_tokens.test.ts` 用真实编译产物验证。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const renderer_root = path.join(import.meta.dirname, "../src/renderer");
const styles_root = path.join(renderer_root, "styles");

/** 参与垂直节奏的两个文档方言样式表。 */
const spacing_styles = ["markdown.css", "mermaid.css"] as const;

/** 去掉注释：注释里会引用被禁止的写法来解释为什么禁止。 */
function strip_comments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

const sources = new Map(spacing_styles.map((name) => [
  name,
  strip_comments(fs.readFileSync(path.join(styles_root, name), "utf8")),
]));

const markdown_styles = sources.get("markdown.css")!;

/**
 * 三档的契约值（em 倍数）。
 *
 * 这是本文件唯一「写死」的地方：改节奏必须先改这里，改的时候会看见它影响了哪些表面。
 * 它们写在 `.markdown` 上而不是 `tokens.css`，是因为 em 在**使用处**解析
 *（自定义属性只是原样替换），所以同一份节奏在 `base` 的会话正文与 `xs` 的 Plugin 说明下
 * 各自成立——搬进 `tokens.css` 会失去这个性质。
 */
const gap_scale = [
  ["--markdown-tight-gap", 0.25],
  ["--markdown-flow-gap", 0.5],
  ["--markdown-block-gap", 0.7],
] as const;

/**
 * 标题那一档：相对**标题自身**字号，所以不并进上面三档。
 *
 * 只有上边距，没有下边距：相邻块的外边距会折叠（取较大值），
 * 标题下方写一个小于正文档的值会被吞掉，写一个大于正文档的值反而让标题离正文更远。
 * 标题与下方内容的距离因此由下面那个块自己的上边距给出。
 */
const heading_gaps = [["--markdown-heading-gap-before", 0.9]] as const;

/**
 * 取出一个选择器的声明块。
 *
 * `[^{]*` 是为了跨过同一条规则里的并列选择器（`.markdown :where(ul, ol), .markdown [data-streamdown=…]`）——
 * 那种写法在本文件里是常态，只按 `selector {` 匹配会找不到规则。
 */
function read_rule(selector_pattern: string, source = markdown_styles): string {
  const match = new RegExp(`${selector_pattern}[^{]*\\{([\\s\\S]*?)\\}`).exec(source);
  assert.ok(match, `找不到规则：${selector_pattern}`);
  return match![1]!;
}

/** 取出一个属性值；取不到即断言失败。 */
function read_declaration(rule: string, property: string, where: string): string {
  const match = new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;]+);`).exec(rule);
  assert.ok(match, `${where} 里没有声明 ${property}`);
  return match![1]!.trim();
}

/** 读出一个 `--markdown-*` 令牌声明的 em 倍数。 */
function read_gap_token(name: string): number {
  const match = new RegExp(`${name}:\\s*([\\d.]+)em;`).exec(markdown_styles);
  assert.ok(match, `markdown.css 里找不到 ${name} 的定义`);
  return Number(match[1]);
}

test("三档间距存在、取值固定，且没有第四档", () => {
  for (const [name, value] of [...gap_scale, ...heading_gaps]) {
    assert.equal(read_gap_token(name), value, `${name} 的取值被改动；节奏的每一档都由本文件的契约表决定`);
  }

  // 第四档会让「这里用哪一档」重新变成每个调用点的自由判断。
  const declared = [...markdown_styles.matchAll(/--markdown-[a-z-]+:/g)].map((match) => match[0].slice(0, -1));
  assert.deepEqual(
    [...new Set(declared)].sort(),
    [...gap_scale, ...heading_gaps].map(([name]) => name).sort(),
    `markdown.css 里的节奏令牌与预期不一致：${[...new Set(declared)].join(", ")}`,
  );
});

test("三档的大小关系成立：紧 < 正文 < 块级", () => {
  const [tight, flow, block] = gap_scale.map(([name]) => read_gap_token(name));
  assert.ok(tight! < flow!, `列表项间距（${tight}em）不小于段落间距（${flow}em）：并列结构会比正文还松`);
  assert.ok(flow! < block!, `段落间距（${flow}em）不小于块级表面间距（${block}em）：插入代码块与另起一段看不出区别`);

  /*
   * 光「大于」不够：块级档与正文档只差 0.1em（1.5px）时，两个层级已经抹平。
   * 用与 `chat_message_layout.test.ts` 同一个可感知下限（0.125rem = 2px）衡量。
   * 按默认正文档 `base`（0.9375rem）换算，这条等价于块级档不得小于 0.5em + 0.133em。
   */
  const body_size_rem = 0.9375;
  const difference_px = (block! - flow!) * body_size_rem * 16;
  assert.ok(
    difference_px >= 2,
    `块级档与正文档只差 ${difference_px.toFixed(2)}px，两个层级会看起来一样；`
      + "要么抬块级档，要么承认它们本该是一档",
  );

  // 标题那一档必须比正文档更有分量，否则「标题起段」的落差消失。
  assert.ok(read_gap_token("--markdown-heading-gap-before") > flow!, "标题上方间距不大于段落间距：标题无法起段");
});

/**
 * 两个文档方言样式表不得再出现字面量 em 外边距。
 *
 * 这条是整个收敛的**实际执行者**：只要有一个人为了某个角落写 `margin: 0.7em 0`，
 * 节奏就重新变成逐条拍值，而那种改动在 review 里只像「调了一下间距」。
 * 允许的写法只有三种：`var(--markdown-*)`、`0`、rem（rem 属于 UI 层，见 chat.css）。
 */
test("文档方言样式表不再出现字面量 em 外边距", () => {
  const literal_em_margin = /margin(?:-[a-z]+)?:\s*[^;]*[\d.]+em/;
  const violations: string[] = [];

  for (const [name, source] of sources) {
    source.split("\n").forEach((line, index) => {
      if (literal_em_margin.test(line)) violations.push(`${name}:${index + 1} → ${line.trim()}`);
    });
  }

  assert.deepEqual(
    violations,
    [],
    `以下外边距写成了 em 字面量，不参与节奏收敛：\n  ${violations.join("\n  ")}\n`
      + "块级元素用 var(--markdown-block-gap)，正文块用 var(--markdown-flow-gap)，"
      + "并列项用 var(--markdown-tight-gap)。确实需要新档时先在本文件与 markdown.css 里同步契约。",
  );
});

test("禁止字面量 em 外边距的规则本身有效", () => {
  // 反向确认：正则必须真的能命中，否则上面那条断言恒真。
  assert.ok(/margin(?:-[a-z]+)?:\s*[^;]*[\d.]+em/.test("  margin: 0.7em 0;"), "扫描规则漏掉了字面量 em 外边距");
  assert.ok(/margin(?:-[a-z]+)?:\s*[^;]*[\d.]+em/.test("  margin-top: 1.1em;"), "扫描规则漏掉了单边 em 外边距");
  assert.ok(!/margin(?:-[a-z]+)?:\s*[^;]*[\d.]+em/.test("  margin: var(--markdown-flow-gap) 0;"), "扫描规则会误报令牌写法");
  assert.ok(!/margin(?:-[a-z]+)?:\s*[^;]*[\d.]+em/.test("  margin: 0.5rem auto;"), "扫描规则会误报 rem 写法");
});

/**
 * 库自带的三处间距必须被显式压掉。
 *
 * 这三条不是「顺便写的」：它们是本文件存在的一半理由。库的间距不报错、不在本仓库里，
 * 只在视觉上表现为「某一类块莫名比别处松」。任何一条被删掉，
 * 对应的现象都会原样回来，而且很难归因。
 */
test("根节点上库写的 space-y-4 被正文节奏覆盖", () => {
  const rule = read_rule("\\.markdown > :where\\(\\*\\)");
  assert.equal(
    read_declaration(rule, "margin-block", "直接子元素兜底间距"),
    "var(--markdown-flow-gap)",
    "直接子元素没有统一兜底正文节奏：Streamdown 的 space-y-4（1rem）会重新生效，"
      + "表格、图片、脚注区等会拿到 16px",
  );
  /*
   * 兜底必须排在具体规则之前。若它被挪到文件末尾，段落、标题、列表都会变成正文档，
   * 而三条档位断言仍然通过——所以顺序本身要单独锁。
   */
  const fallback = markdown_styles.indexOf(".markdown > :where(*)");
  const paragraph = markdown_styles.indexOf(".markdown :where(p)");
  const heading = markdown_styles.indexOf(".markdown :where(h1, h2, h3, h4, h5, h6)");
  assert.ok(fallback < paragraph && fallback < heading, "兜底规则排到了具体规则之后：它会盖掉段落与标题的档位");
});

test("列表项上库写的 py-1 被清掉，项间距只由紧档决定", () => {
  const rule = read_rule('\\.markdown \\[data-streamdown="list-item"\\]');
  const padding = read_declaration(rule, "padding", "列表项").split(/\s+/);
  assert.ok(padding.length >= 2, `列表项必须用简写声明 padding，否则清不掉库的 py-1：${padding.join(" ")}`);
  /*
   * 简写的四个值按「上 右 下 左」展开。上下两个必须为 0：
   * 留任何一个，相邻两项之间就是 4px + 4px + 紧档 = 9.5px，比段落还松。
   */
  assert.equal(padding[0], "0", `列表项的上内边距没清零（库的 py-1 会与项间距叠加）：${padding.join(" ")}`);
  assert.equal(padding[2] ?? padding[0], "0", `列表项的下内边距没清零（库的 py-1 会与项间距叠加）：${padding.join(" ")}`);

  const gap = read_rule('\\.markdown \\[data-streamdown="list-item"\\] \\+ \\[data-streamdown="list-item"\\]');
  assert.equal(
    read_declaration(gap, "margin-top", "列表项间距"),
    "var(--markdown-tight-gap) !important",
    "相邻列表项的间距不是紧档",
  );
});

test("图片容器上库写的 my-4 被块级档覆盖，且外边距只算一次", () => {
  const wrapper = read_rule('\\.markdown \\[data-streamdown="image-wrapper"\\]');
  assert.equal(
    read_declaration(wrapper, "margin", "图片容器"),
    "var(--markdown-block-gap) 0 !important",
    "图片容器没有压掉库的 my-4（1rem）：图片会拿到 16 + 12 = 28px 的外边距",
  );
  // 容器内的图片自己不能再给一次外边距，否则同一个方向算两遍。
  const inner = read_rule('\\.markdown \\[data-streamdown="image-wrapper"\\] > :where\\(img\\)');
  assert.ok(/^0\b/.test(read_declaration(inner, "margin", "容器内图片")), "容器内图片又给了一次外边距：间距会翻倍");
});

test("标题只给上边距，下边距交给下面那个块", () => {
  const rule = read_rule("\\.markdown :where\\(h1, h2, h3, h4, h5, h6\\)");
  const margin = read_declaration(rule, "margin", "标题").split(/\s+/);
  assert.equal(margin[0], "var(--markdown-heading-gap-before)", `标题上边距不是标题档：${margin.join(" ")}`);
  assert.equal(margin[2] ?? margin[0], "0", `标题声明了下边距（${margin.join(" ")}）；它必然被外边距折叠吞掉，是死值`);
});

test("首尾块的外边距清零排在所有块级规则之后", () => {
  /*
   * 这两条与块级规则（代码块、表格、图片容器）的特异性相同（都是 `.markdown` + 一个选择器），
   * 只能靠源码顺序决出胜负。它们曾经排在前面，于是在那些元素上完全无效：
   * 以代码块开头的消息会在身份行下多出一段留白，而容器是 flex 列，
   * 外边距不会与 gap 折叠，留白是实打实叠上去的。
   */
  const first_child = markdown_styles.indexOf(".markdown > :first-child");
  assert.ok(first_child !== -1, "找不到 `.markdown > :first-child`：首尾块的外边距会漏出来");
  /*
   * 两条都必需：顺序决定普通声明，`!important` 决定与块级规则的胜负
   *（它们带 `!important`，特异性相同）。缺任何一条，代码块/表格/图片作为首块时都会漏出留白。
   */
  for (const [selector, declaration] of [
    [".markdown > :first-child", "margin-top"],
    [".markdown > :last-child", "margin-bottom"],
  ] as const) {
    const rule = read_rule(selector.replace(/\./g, "\\.").replace(/ > /g, " > "));
    assert.equal(
      read_declaration(rule, declaration, selector),
      "0 !important",
      `${selector} 的 ${declaration} 不是「0 !important」：块级规则带 !important 且特异性相同，会把它压掉`,
    );
  }

  const surfaces = [
    '\\.markdown \\[data-streamdown="code-block"\\]',
    '\\.markdown div\\[data-streamdown="table-wrapper"\\]',
    '\\.markdown \\[data-streamdown="image-wrapper"\\]',
  ];
  for (const selector of surfaces) {
    const position = markdown_styles.search(new RegExp(`${selector}[^{]*\\{`));
    assert.ok(position !== -1, `找不到块级规则：${selector}`);
    assert.ok(
      first_child > position,
      `首尾清零排在了块级规则（${selector}）之前：该元素作为消息首块时清不掉上外边距，`
        + "身份行与它之间会多出一段留白",
    );
  }
});

/**
 * 块级表面用块级档。
 *
 * 这些元素都在正文中间「插进来」，与段落的关系是同一种：读到这里要停一下。
 * 逐条列出而不是抽查，是因为漏掉一个就会回到「某处莫名松一点」的状态。
 */
test("块级表面统一使用块级档", () => {
  const surfaces: readonly [string, string][] = [
    ['\\.markdown \\[data-streamdown="code-block"\\]', "代码块"],
    ['\\.markdown div\\[data-streamdown="table-wrapper"\\]', "表格"],
    ['\\.markdown \\[data-streamdown="image-wrapper"\\]', "图片"],
    ["\\.markdown :where\\(blockquote\\)", "引用块"],
    ["\\.markdown :where\\(hr\\)", "分隔线"],
    ["\\.markdown :where\\(\\.katex-display\\)", "块级公式"],
    ["\\.markdown \\.markdown-mermaid", "Mermaid 图表（mermaid.css）"],
  ];

  for (const [selector, label] of surfaces) {
    const source = selector.includes("markdown-mermaid") ? sources.get("mermaid.css")! : markdown_styles;
    const margin = read_declaration(read_rule(selector, source), "margin", label);
    assert.ok(
      margin.includes("var(--markdown-block-gap)"),
      `${label} 没有用块级档：${margin}`,
    );
  }
});

test("正文档与紧档落在该落的位置", () => {
  // 段落与列表块之间是正文档；引用块**内部**的段落是紧档（它们在同一个引用里）。
  for (const [selector, label] of [
    ["\\.markdown :where\\(p\\)", "段落"],
    ["\\.markdown :where\\(ul, ol\\)", "列表块"],
  ] as const) {
    const margin = read_declaration(read_rule(selector), "margin", label);
    assert.ok(margin.includes("var(--markdown-flow-gap)"), `${label} 没有用正文档：${margin}`);
  }
  assert.equal(
    read_declaration(read_rule("\\.markdown :where\\(blockquote p\\)"), "margin", "引用内段落"),
    "var(--markdown-tight-gap) 0",
    "引用块内的段落不是紧档：引用会看起来像一叠独立的段落",
  );
});
