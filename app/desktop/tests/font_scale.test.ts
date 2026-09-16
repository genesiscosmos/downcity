/**
 * 语义字号的守卫。
 *
 * ## 为什么需要这个文件
 *
 * 这套 UI 的字号曾经完全靠「改一次、写一次」积累出来，应用里同时存在 13 档：
 * `text-xs`、`text-sm`、`text-[0.625rem]`、`text-[0.6875rem]`、`text-[0.5625rem]` …
 * 落差只有 0.5px 的相邻档位（10 与 10.5、11 与 11.5、12 与 12.5）同时存在，
 * 于是「这行该用哪一档」在每个调用点都要重新决定一次，而 0.5px 的差别没人能看出，
 * 只剩下无法收敛的漂移。
 *
 * 现在字号收敛为 9 级语义档位（`tokens.css` 的 `--text-3xs` … `--text-3xl`），
 * 并且**七个与 Tailwind 同名的档位（`xs` … `3xl`）必须与 Tailwind 的默认主题完全等值**。
 *
 * ## 为什么「等值」要专门测
 *
 * 档名是前端的公共词汇。只要同名不同值，从 Tailwind 文档或其他项目复制类名
 * 就会拿到错误的尺寸，而且错误只在渲染后才看得出来——回归成本很高。
 * 更麻烦的是这类偏移很容易被「都是相对单位、看着差不多」合理化。
 *
 * 因此 `tests/font_scale.test.ts` 不自己维护一张期望表：它**编译一份 Tailwind 默认主题**，
 * 把 `--text-*` 的真值读出来，再与 `tokens.css` 逐项对照。Tailwind 升版改了默认值，
 * 这里的测试会失败并告诉我们需要重新对齐。
 *
 * 除等值之外，本文件还守住四类会静默发生的退化：
 *
 * 1. **档位表本身**：只有 9 级、全部 rem、递增、成对行高。
 * 2. **代码里的用法**：只能用这 9 个档名，不能出现任意值，且每一个写下的 `text-*`
 *    都必须真的能被 Tailwind 编译出规则。
 * 3. **两处清单一致**：`tokens.css` 定义几级，`lib/utils.ts` 注册进 tailwind-merge
 *    的就有几级。少注册一级，那一级会在所有 `cn()` 调用点被静默删除。
 * 4. **真的能生成**：9 个档位都产出规则，而 `4xl` 及以上一个都不产出。
 *
 * ## 有意留下的例外
 *
 * `markdown.css`、`mermaid.css`、`base.css` 里的 `font-size` 用的是 **em 相对值**
 *（`.markdown h1 { font-size: 1.55em }` 这类）。它们不是 UI 层级，而是文档方言：
 * 标题、行内码、表格相对**承载它们的正文字号**缩放，正文一变它们必须跟着变。
 * 因此规则是「样式表里要么引用语义令牌，要么是 em / inherit」，
 * em 只允许出现在这三个文档方言样式表里。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { compile } from "tailwindcss";
import { font_size_scale } from "../src/renderer/lib/utils.ts";

const renderer_root = path.join(import.meta.dirname, "../src/renderer");
const styles_root = path.join(renderer_root, "styles");

const tokens_css = fs.readFileSync(path.join(styles_root, "tokens.css"), "utf8");
const utils_source = fs.readFileSync(path.join(renderer_root, "lib/utils.ts"), "utf8");

/** 允许使用 em 相对字号的文件：它们排版的是文档方言，不是 UI 层级。 */
const document_dialect_styles = ["markdown.css", "mermaid.css", "base.css"];

/**
 * 本应用自有、Tailwind 没有的档位：数值自行决定，只需小于 `xs`。
 * 其余 7 级（`xs` … `3xl`）必须与 Tailwind 等值。
 */
const own_levels: readonly (readonly [string, string])[] = [["3xs", "0.625rem"], ["2xs", "0.6875rem"]];

/** 必须与 Tailwind 默认主题等值的档位，由小到大。 */
const tailwind_aligned_levels = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl"] as const;

/** 9 级阶梯的完整顺序。 */
const expected_levels = [...own_levels.map(([name]) => name), ...tailwind_aligned_levels];

/** Tailwind 自带档位里本应用**不**定义的那些；它们不得再产出规则。 */
const third_party_only_levels = ["4xl", "5xl", "6xl", "7xl", "8xl", "9xl"];

// ---------------------------------------------------------------------------
// Tailwind 本尊：读默认主题的真值
// ---------------------------------------------------------------------------

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

/** 用应用真实的样式入口编译，只喂入待验证的候选类名。 */
async function compile_app_styles() {
  const entry = path.join(styles_root, "base.css");
  return compile(fs.readFileSync(entry, "utf8"), {
    base: path.dirname(entry),
    loadStylesheet: async (id: string, from: string) => {
      const resolved = id === "tailwindcss"
        ? path.join(tailwind_root, "index.css")
        : path.resolve(from, id.startsWith(".") ? id : `${id}.css`);
      if (!fs.existsSync(resolved)) throw new Error(`无法解析样式表：${id}（来自 ${from}）`);
      return { path: resolved, base: path.dirname(resolved), content: fs.readFileSync(resolved, "utf8") };
    },
  });
}

/**
 * 读出 Tailwind **默认主题**的档位真值（不带本应用的任何覆盖）。
 *
 * Tailwind v4 的行高写成比例（`calc(1.25 / 0.875)`），因此这里把它折算成 rem：
 * 比例 × 字号。折算结果与 `tokens.css` 里写的绝对 rem 相等，
 * 这样两处可以直接按同一个量纲比对。
 */
async function read_tailwind_default_scale(): Promise<Map<string, { size_rem: number; line_height_rem: number }>> {
  const compiler = await compile('@import "tailwindcss";', {
    base: styles_root,
    loadStylesheet: async () => {
      const index_css = path.join(tailwind_root, "index.css");
      return { path: index_css, base: path.dirname(index_css), content: fs.readFileSync(index_css, "utf8") };
    },
  });
  const css = compiler.build([...tailwind_aligned_levels].map((name) => `text-${name}`));

  const scale = new Map<string, { size_rem: number; line_height_rem: number }>();
  for (const name of tailwind_aligned_levels) {
    const size = new RegExp(`--text-${name}:\\s*([\\d.]+)rem;`).exec(css);
    const ratio = new RegExp(`--text-${name}--line-height:\\s*calc\\(([\\d.]+)\\s*/\\s*([\\d.]+)\\)`).exec(css);
    assert.ok(size, `Tailwind 默认主题里没有 --text-${name}；本文件的解析方式可能已失效`);
    assert.ok(ratio, `Tailwind 默认主题里 --text-${name}--line-height 不是 calc(比例) 写法；本文件的解析方式可能已失效`);
    const size_rem = Number(size[1]);
    scale.set(name, { size_rem, line_height_rem: Number(ratio[1]) });
  }
  // 解析方式自检：Tailwind 的 xs 必须是 0.75rem，否则说明上面读到的不是那些令牌。
  assert.equal(scale.get("xs")!.size_rem, 0.75, "Tailwind 默认的 xs 不是 0.75rem，解析方式或依赖版本发生了变化");
  return scale;
}

/** 读出 `tokens.css` 的定义：档名 → { size_rem, line_height }（行高原样字符串）。 */
function read_declared_scale(): Map<string, { size_rem: number; line_height: string }> {
  const scale = new Map<string, { size_rem: number; line_height: string }>();
  for (const match of tokens_css.matchAll(/--text-([a-z0-9]+):\s*([\d.]+)rem;/g)) {
    scale.set(match[1]!, { size_rem: Number(match[2]), line_height: "" });
  }
  for (const match of tokens_css.matchAll(/--text-([a-z0-9]+)--line-height:\s*([^;]+);/g)) {
    const entry = scale.get(match[1]!);
    assert.ok(entry, `--text-${match[1]}--line-height 没有对应的字号档位`);
    entry.line_height = match[2]!.trim();
  }
  return scale;
}

// ---------------------------------------------------------------------------
// 1. 档位表与 Tailwind 等值
// ---------------------------------------------------------------------------

test("语义字号恰好 9 级，且声明了 Tailwind 默认命名空间的重置", () => {
  assert.ok(
    /--text-\*:\s*initial/.test(tokens_css),
    "tokens.css 没有 `--text-*: initial`：Tailwind 自带的档位仍然可用，"
      + "新代码可以绕过 9 级语义档位，收敛立刻失效",
  );
  assert.equal(expected_levels.length, 9, "9 级档位是明确的设计要求");

  const declared = [...read_declared_scale().keys()];
  assert.deepEqual(
    declared.sort(),
    [...expected_levels].sort(),
    `tokens.css 定义的档位与预期不一致：${declared.join(", ")}。\n`
      + "加第 10 级会让「这行该用哪一档」重新变成每个调用点的自由判断。",
  );
});

test("xs … 3xl 的字号与 Tailwind 默认主题完全等值", async () => {
  const tailwind = await read_tailwind_default_scale();
  const declared = read_declared_scale();

  const mismatched: string[] = [];
  for (const name of tailwind_aligned_levels) {
    const expected = tailwind.get(name)!;
    const actual = declared.get(name);
    assert.ok(actual, `tokens.css 缺少 --text-${name}`);
    if (actual.size_rem !== expected.size_rem) {
      mismatched.push(`--text-${name}: 本应用 ${actual.size_rem}rem，Tailwind ${expected.size_rem}rem`);
    }
  }
  assert.deepEqual(
    mismatched,
    [],
    `以下档位与 Tailwind 同名档位不等值：\n  ${mismatched.join("\n  ")}\n`
      + "档名是前端的公共词汇，同名不同值会让从 Tailwind 文档复制类名时拿到错误的尺寸。",
  );
});

test("xs … 3xl 的配对行高也与 Tailwind 等值", async () => {
  const tailwind = await read_tailwind_default_scale();
  const declared = read_declared_scale();

  const mismatched: string[] = [];
  for (const name of tailwind_aligned_levels) {
    const expected = tailwind.get(name)!.line_height_rem;
    const raw = declared.get(name)!.line_height;
    // 允许两种写法：等值的绝对 rem，或 Tailwind 的比例写法。两者的计算值相同。
    const size = declared.get(name)!.size_rem;
    const ratio = /^calc\(\s*([\d.]+)\s*\/\s*([\d.]+)\s*\)$/.exec(raw);
    const actual = ratio ? (Number(ratio[1]) / Number(ratio[2])) * size : Number(raw.replace("rem", ""));
    assert.ok(Number.isFinite(actual), `--text-${name}--line-height 无法解析：${raw}`);
    if (Math.abs(actual - expected) > 1e-6) {
      mismatched.push(`--text-${name}--line-height: 本应用折合 ${actual}rem，Tailwind ${expected}rem`);
    }
  }
  assert.deepEqual(mismatched, [], `以下档位的配对行高与 Tailwind 不等值：\n  ${mismatched.join("\n  ")}`);
});

test("自有档位 3xs / 2xs 小于 xs，且全部是 rem", () => {
  const declared = read_declared_scale();
  const xs = declared.get("xs")!.size_rem;
  for (const [name, size] of own_levels) {
    const actual = declared.get(name);
    assert.ok(actual, `tokens.css 缺少 --text-${name}`);
    assert.equal(actual.size_rem, Number.parseFloat(size), `--text-${name} 的值与预期不符`);
    assert.ok(actual.size_rem < xs, `--text-${name}（${actual.size_rem}rem）不小于 xs（${xs}rem）`);
    assert.ok(/rem$/.test(actual.line_height), `--text-${name}--line-height 必须是 rem：${actual.line_height}`);
  }
});

test("字号递增，且每级都有配对行高", () => {
  const declared = read_declared_scale();
  const sizes = expected_levels.map((name) => declared.get(name)!.size_rem);
  for (let index = 1; index < sizes.length; index += 1) {
    assert.ok(
      sizes[index]! > sizes[index - 1]!,
      `档位不递增：${expected_levels[index]}（${sizes[index]}rem）不大于 ${expected_levels[index - 1]}（${sizes[index - 1]}rem）`,
    );
  }
  for (const name of expected_levels) {
    assert.ok(declared.get(name)!.line_height, `--text-${name} 没有成对的 --text-${name}--line-height`);
  }
});

// ---------------------------------------------------------------------------
// 2. 代码里的用法
// ---------------------------------------------------------------------------

/** 递归收集待扫描文件。 */
function collect_files(directory: string, extensions: RegExp): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full_path = path.join(directory, entry.name);
    if (entry.isDirectory()) return collect_files(full_path, extensions);
    return extensions.test(entry.name) ? [full_path] : [];
  });
}

/**
 * 去掉注释行。
 *
 * 注释里出现旧档名往往是在解释「为什么曾经那样」，把它算作违规会让守卫自相矛盾：
 * 越写清楚原因越报错。与 `design_token_drift.test.ts` 的处理方式一致。
 */
function code_lines(source: string): { text: string; line: number }[] {
  return source.split("\n").flatMap((text, index) => {
    const trimmed = text.trim();
    if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) return [];
    return [{ text, line: index + 1 }];
  });
}

test("渲染层不再使用 9 级之外的字号档位", () => {
  // 4xl 及以上在 `--text-*: initial` 之后根本生成不出规则，写了就是静默失效的字号。
  const banned = new RegExp(`\\btext-(?:${third_party_only_levels.join("|")})(?![\\w-])`);
  const violations = collect_files(renderer_root, /\.tsx?$/)
    .flatMap((file) => code_lines(fs.readFileSync(file, "utf8"))
      .filter(({ text }) => banned.test(text))
      .map(({ text, line }) => `${path.relative(renderer_root, file)}:${line}\n    ${text.trim().slice(0, 120)}`));

  assert.deepEqual(
    violations,
    [],
    `发现 ${violations.length} 处越界字号，只能用 ${expected_levels.map((name) => `text-${name}`).join(" / ")}：\n  ${violations.join("\n  ")}`,
  );
});

test("渲染层不再使用任意字号值", () => {
  // 任意值不跟随界面缩放（缩放通过根元素 font-size 实现），而且绕过了档位收敛。
  // 颜色不受影响：`text-[#6f69f7]` 不含长度单位，不在匹配范围内。
  const arbitrary = /text-\[[^\]]*(?:rem|px|em|pt|ch|ex|vh|vw|calc\()/;
  const violations = collect_files(renderer_root, /\.tsx?$/)
    .flatMap((file) => code_lines(fs.readFileSync(file, "utf8"))
      .filter(({ text }) => arbitrary.test(text))
      .map(({ text, line }) => `${path.relative(renderer_root, file)}:${line}\n    ${text.trim().slice(0, 120)}`));

  assert.deepEqual(violations, [], `发现 ${violations.length} 处任意字号：\n  ${violations.join("\n  ")}`);
});

test("源码里的每一个 text-* 类名都真的能生成规则", async () => {
  /*
   * 这是「档名写错」唯一可靠的检法：不看名字像不像，直接问 Tailwind 能不能生成。
   *
   * 拼错档名（`text-2x`、`text-bse`）、残留旧档名都不会报错，也不会生成规则——
   * 元素静默退回继承的字号，看起来「只是有点不对」。
   * 而颜色（`text-amber-600`）与对齐（`text-center`）同样以 `text-` 开头，
   * 用名字模式区分总会有假阳或假阴；用编译器当裁判则两边都准。
   *
   * 只取「类的起始位置」上的 token（按空白切分字符串字面量），
   * 因此像 `user-message-text-part` 这种名字里带 text- 的类不会被误判。
   */
  const candidates = new Set<string>();
  for (const file of collect_files(renderer_root, /\.tsx?$/)) {
    for (const { text } of code_lines(fs.readFileSync(file, "utf8"))) {
      for (const literal of text.matchAll(/"([^"\n]*)"|'([^'\n]*)'/g)) {
        for (const token of (literal[1] ?? literal[2] ?? "").split(/\s+/)) {
          if (token.includes("${")) continue;
          const last_segment = token.split(":").pop()!;
          if (last_segment.startsWith("text-")) candidates.add(token);
        }
      }
    }
  }
  assert.ok(candidates.size >= 9, `只扫到 ${candidates.size} 个 text-* 类名，扫描方式可能已失效`);

  const compiler = await compile_app_styles();
  const css = compiler.build([...candidates]).replace(/\\/g, "");
  /*
   * 用「类名 + 词边界」判规则是否存在，不能用子串包含：
   * `.text-2x` 是 `.text-2xs` 的前缀，子串匹配会把拼错的 `text-2x` 当成存在。
   */
  const generates = (token: string) => new RegExp(`\\.${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(css);
  const dead = [...candidates].filter((token) => !generates(token)).sort();

  assert.deepEqual(
    dead,
    [],
    `以下 text-* 类名不会生成任何规则，元素会静默退回继承字号：\n  ${dead.join("\n  ")}\n`
      + `字号档位只有 ${expected_levels.map((name) => `text-${name}`).join(" / ")}；其余 text-* 必须是可生成的颜色 / 对齐类。`,
  );
});

test("样式表里的字号只能引用语义令牌，或使用 em 相对值", () => {  const violations: string[] = [];
  const token_pattern = new RegExp(`^var\\(--text-(?:${expected_levels.join("|")})\\)`);
  for (const file of collect_files(styles_root, /\.css$/)) {
    const name = path.basename(file);
    if (name === "tokens.css") continue; // 令牌定义处，字号的真身。
    const allows_em = document_dialect_styles.includes(name);
    code_lines(fs.readFileSync(file, "utf8")).forEach(({ text, line }) => {
      const match = /font-size:\s*([^;]+);/.exec(text);
      if (!match) return;
      const value = match[1]!.trim();
      if (token_pattern.test(value)) return;
      // 文档方言可以用 em 相对值（可带 !important）。
      if (allows_em && /^[\d.]+em(?:\s*!important)?$/.test(value)) return;
      if (value === "inherit") return;
      violations.push(`${name}:${line} → font-size: ${value}`);
    });
  }
  assert.deepEqual(
    violations,
    [],
    `样式表里出现了不受控的字号：\n  ${violations.join("\n  ")}\n`
      + "只能写 var(--text-<档位>)；文档方言样式表（markdown/mermaid/base）可以用 em 相对值。",
  );
});

// ---------------------------------------------------------------------------
// 3. Markdown 宿主必须自己声明字号
// ---------------------------------------------------------------------------

/**
 * 每个渲染 `<Markdown>` 的文件都必须自己声明字号。
 *
 * `markdown.css` 的 `.markdown` 是 `font-size: inherit`：同一套 Markdown 要同时服务于
 * 消息正文（`sm`）、Workspace 文档预览（`sm`）与 Plugin 说明（Plugin 自己的 `xs`），
 * 因此基准字号必须由宿主给出。
 *
 * 这是继承制的代价：新加一个 Markdown 宿主而忘了声明字号时，
 * 它会静默继承到无关的祖先字号（可能是标题的 `xl`），不报错、不报类型错，
 * 只在某个具体界面看起来「字号奇怪」。所以这里把它盯住。
 */
test("每个渲染 Markdown 的文件都自己声明了字号", () => {
  const definition = path.join(renderer_root, "components/markdown/Markdown.tsx");
  const hosts = collect_files(renderer_root, /\.tsx?$/)
    .filter((file) => file !== definition)
    .filter((file) => /<Markdown\b/.test(fs.readFileSync(file, "utf8")));
  assert.ok(hosts.length >= 5, `只扫到 ${hosts.length} 个 Markdown 宿主，扫描方式可能已失效`);

  const missing = hosts.filter((file) => {
    const source = fs.readFileSync(file, "utf8");
    const declares_size = new RegExp(`text-(?:${expected_levels.join("|")})\\b`).test(source)
      || source.includes("chat_message_text_class_name");
    return !declares_size;
  }).map((file) => path.relative(renderer_root, file));

  assert.deepEqual(
    missing,
    [],
    `以下文件渲染了 Markdown 但没有声明字号，会静默继承祖先字号：\n  ${missing.join("\n  ")}\n`
      + "在包含 <Markdown> 的容器上加语义档位（或消息正文的 chat_message_text_class_name）。",
  );
});

// ---------------------------------------------------------------------------
// 4. 两处清单一致
// ---------------------------------------------------------------------------

test("tailwind-merge 注册的档位与 tokens.css 完全一致", () => {
  const registered = [...utils_source.matchAll(/"([a-z0-9]+)"/g)]
    .map((match) => match[1]!)
    .filter((name) => expected_levels.includes(name));

  assert.deepEqual(
    registered,
    expected_levels,
    "lib/utils.ts 的 font_size_scale 与 tokens.css 的档位不一致（含顺序）。\n"
      + "tailwind-merge 只保留它认识的 font-size 类；漏注册的档位会在每个 cn() 调用点被当成文字颜色删除（静默失败）。",
  );
  assert.deepEqual([...font_size_scale], expected_levels, "导出的 font_size_scale 与源码不一致");
});

// ---------------------------------------------------------------------------
// 5. 真的能生成
// ---------------------------------------------------------------------------

/** 类名对应的规则块里是否包含指定声明（去掉选择器转义后按词边界定位）。 */
function has_declaration(css: string, class_name: string, fragment: string): boolean {
  const normalized = css.replace(/\\/g, "");
  const needle = `.${class_name}`;
  for (let index = normalized.indexOf(needle); index !== -1; index = normalized.indexOf(needle + " ", index + 1)) {
    const boundary = normalized[index + needle.length];
    if (boundary !== undefined && /[\w-]/.test(boundary)) continue;
    if (normalized.slice(index, index + 400).includes(fragment)) return true;
  }
  return false;
}

test("9 个语义档位都能生成真实规则，并解析到声明里的 rem 值", async () => {
  const compiler = await compile_app_styles();
  const css = compiler.build(expected_levels.map((name) => `text-${name}`));

  const missing = expected_levels
    .filter((name) => !has_declaration(css, `text-${name}`, `font-size: var(--text-${name})`))
    .map((name) => `text-${name}`);
  assert.deepEqual(missing, [], `以下档位没有生成 font-size 声明：${missing.join(", ")}`);

  // 配对的 line-height 通过 --tw-leading 兜底，因此显式 leading-* 总能覆盖它。
  const without_fallback = expected_levels
    .filter((name) => !has_declaration(css, `text-${name}`, `var(--text-${name}--line-height)`))
    .map((name) => `text-${name}`);
  assert.deepEqual(without_fallback, [], `以下档位没有生成配对行高：${without_fallback.join(", ")}`);
});

test("4xl 及以上一个都不再生成", async () => {
  const compiler = await compile_app_styles();
  const css = compiler.build([...third_party_only_levels.map((name) => `text-${name}`), "text-sm"]);

  const generated = third_party_only_levels.filter((name) => has_declaration(css, `text-${name}`, "font-size"));
  assert.deepEqual(
    generated,
    [],
    `4xl 及以上的档位仍然能生成规则：${generated.map((name) => `text-${name}`).join(", ")}。\n`
      + "说明 tokens.css 的 `--text-*: initial` 失效了，应用里会同时存在两套字号体系。",
  );

  // 反向确认：本测试不是恒真的。
  assert.ok(has_declaration(css, "text-sm", "font-size: var(--text-sm)"), "语义档位在同一次编译里也生成不出规则，本测试无法证明任何事");
});
