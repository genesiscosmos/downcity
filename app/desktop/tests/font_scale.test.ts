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
 * `base` 为默认档。
 *
 * ## 这里最关键的一条：档名与数值的对应关系
 *
 * 档名沿用前端传统命名，但**数值是本应用自有的阶梯，与 Tailwind 同名档位不等值**：
 * 从 `sm` 到 `lg` 三档都比 Tailwind 小一档左右（本应用 `base` = 0.875rem，Tailwind = 1rem），
 * `xs` 与 `xl` 及以上四档与 Tailwind 相同。原因是本应用是密集的桌面工具，
 * Tailwind 的 `base` = 1rem（16px）对默认正文偏大。
 *
 * 代价是「凭 Tailwind 文档的记忆写代码」会拿到错误尺寸（写 `text-base` 得到 0.875rem）。
 * 因此下面把「档名 → rem」**硬编码**成断言，而不是从源码读出来再自比：
 * 从源码读出来的话，值被改成什么都测不出来；硬编码才能把这件事钉住。
 *
 * 除它之外，本文件还守住四类会静默发生的退化：
 *
 * 1. **档位表本身**：只有 9 级、全部 rem、递增、成对行高。
 * 2. **代码里的用法**：不能出现这 9 个之外的字号档名，也不能出现任意值。
 * 3. **两处清单一致**：`tokens.css` 定义几级，`lib/utils.ts` 注册进 tailwind-merge
 *    的就有几级。少注册一级，那一级会在所有 `cn()` 调用点被静默删除。
 * 4. **真的能生成**：9 个档位都产出规则，而 `4xl` 及以上一个都不产出。
 * *
 * ## 完整阶梯（唯一权威表）
 *
 * | 档位 | 字号 | 配对行高 | 像素等效 |
 * | --- | --- | --- | --- |
 * | `3xs` | 0.625rem | 0.875rem | 10 / 14px |
 * | `2xs` | 0.6875rem | 0.9375rem | 11 / 15px |
 * | `xs` | 0.75rem | 1rem | 12 / 16px |
 * | `sm` | 0.8125rem | 1.1875rem | 13 / 19px |
 * | `base` | 0.875rem | 1.25rem | 14 / 20px |
 * | `lg` | 1rem | 1.5rem | 16 / 24px |
 * | `xl` | 1.25rem | 1.75rem | 20 / 28px |
 * | `2xl` | 1.5rem | 2rem | 24 / 32px |
 * | `3xl` | 1.875rem | 2.25rem | 30 / 36px |
 *
 * 每一级都落在 **1/16rem（0.0625rem）网格**上，因此 100% 缩放下像素值全是整数。
 * 这条性质由 `font_scale.test.ts` 的「都落在 1/16rem 网格上」断言盯住。
 *
 * ## 有意留下的例外
 *
 * `markdown.css`、`mermaid.css`、`base.css` 里的 `font-size` 用 **em 相对值**
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
 * 契约：档名 → [字号(rem), 配对行高(rem)]。
 *
 * 这是本文件唯一「写死」的地方，也是整个字号体系的验收标准。
 * 改档位数值时必须改这里，改的时候会看见它到底影响了哪一级。
 */
const expected_scale: readonly (readonly [string, string, string])[] = [
  ["3xs", "0.625rem", "0.875rem"],
  ["2xs", "0.6875rem", "0.9375rem"],
  ["xs", "0.75rem", "1rem"],
  ["sm", "0.8125rem", "1.1875rem"],
  ["base", "0.875rem", "1.25rem"],
  ["lg", "1rem", "1.5rem"],
  ["xl", "1.25rem", "1.75rem"],
  ["2xl", "1.5rem", "2rem"],
  ["3xl", "1.875rem", "2.25rem"],
];

/** 1/16 rem = 1px @ 100% 缩放；所有档位必须落在它的整数倍上。 */
const GRID_REM = 0.0625;

/** 默认档：全应用的「普通文字」。 */
const default_level = "base";

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

/** 9 级阶梯的档名，由小到大。 */
const expected_levels = expected_scale.map(([name]) => name);

// ---------------------------------------------------------------------------
// 1. 档位表与契约
// ---------------------------------------------------------------------------

test("语义字号恰好 9 级，且声明了 Tailwind 默认命名空间的重置", () => {
  assert.ok(
    /--text-\*:\s*initial/.test(tokens_css),
    "tokens.css 没有 `--text-*: initial`：Tailwind 自带的档位仍然可用，"
      + "新代码可以绕过 9 级语义档位，收敛立刻失效",
  );
  assert.equal(expected_scale.length, 9, "9 级档位是明确的设计要求");

  const declared = [...read_declared_scale().keys()];
  assert.deepEqual(
    declared.sort(),
    [...expected_levels].sort(),
    `tokens.css 定义的档位与预期不一致：${declared.join(", ")}。\n`
      + "加第 10 级会让「这行该用哪一档」重新变成每个调用点的自由判断。",
  );
});

/**
 * 字号与配对行高必须与契约表逐项相等。
 *
 * 这套阶梯是**自有**的，与 Tailwind 同名档位不等值（`xs` 到 `lg` 都小一档左右）。
 * 所以不能用“向 Tailwind 比对”来验证，只能把期望值写在这里。
 * 好处是它同时管住了三件事：数值、行高、以及“改了值但没改契约”。
 */
test("每一级的字号与配对行高都与契约表一致", () => {
  const declared = read_declared_scale();

  const mismatched: string[] = [];
  for (const [name, size, line_height] of expected_scale) {
    const actual = declared.get(name);
    assert.ok(actual, `tokens.css 缺少 --text-${name}`);
    if (`${actual.size_rem}rem` !== size) {
      mismatched.push(`--text-${name}: 期望 ${size}，实际 ${actual.size_rem}rem`);
    }
    // 行高只接受绝对 rem；Tailwind 的 calc 比例写法在本应用语义不明确，不用。
    if (actual.line_height !== line_height) {
      mismatched.push(`--text-${name}--line-height: 期望 ${line_height}，实际 ${actual.line_height}`);
    }
  }
  assert.deepEqual(
    mismatched,
    [],
    `以下档位与契约表不符：\n  ${mismatched.join("\n  ")}\n`
      + "档名沿用 Tailwind 命名但数值是本应用自有的，对应关系只能由本文件的 expected_scale 保证。",
  );
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

test("每一级的字号与配对行高都落在 1/16rem 网格上", () => {
  /*
   * 1rem = 16px，所以 0.0625rem 正好是 1px：落在网格上就等于**在 100% 缩放下
   * 像素值是整数**，不会出现半像素字形。
   *
   * 注意 0.05rem 作步进是无效的（0.05rem = 0.8px），所以这里检查的是 1/16 而不是 1/20。
   * 整数倍判定用容差比较，避开浮点误差。
   */
  const declared = read_declared_scale();
  const off_grid: string[] = [];

  const check = (label: string, value_rem: number) => {
    const steps = value_rem / GRID_REM;
    if (Math.abs(steps - Math.round(steps)) > 1e-9) {
      off_grid.push(`${label}: ${value_rem}rem（= ${(value_rem * 16).toFixed(3)}px）`);
    }
  };

  for (const name of expected_levels) {
    check(`--text-${name}`, declared.get(name)!.size_rem);
    const line_height = /^([\d.]+)rem$/.exec(declared.get(name)!.line_height);
    assert.ok(line_height, `--text-${name}--line-height 不是绝对 rem：${declared.get(name)!.line_height}`);
    check(`--text-${name}--line-height`, Number(line_height[1]));
  }

  assert.deepEqual(
    off_grid,
    [],
    `以下数值不在 1/16rem 网格上，100% 缩放下会出现小数像素：\n  ${off_grid.join("\n  ")}\n`
      + "把数值改成 0.0625rem 的整数倍（即换算成 px 后是整数），再同步本文件的契约表。",
  );
});

/**
 * 反向确认：「网格」断言不是恒真的。
 *
 * 取一个上一版用过的非网格值（0.9rem = 14.4px），它必须被判为越界。
 */
test("非网格值确实会被判为越界（证明上面那条断言有效）", () => {
  const steps = 0.9 / GRID_REM;
  assert.ok(
    Math.abs(steps - Math.round(steps)) > 1e-9,
    "0.9rem 竟然被判为落在 1/16rem 网格上：上面那条断言可能恒真",
  );
  assert.equal(0.9 * 16, 14.4, "0.9rem 的像素值应当不是整数，本测试的前提已失效");
});

test("默认档 base 是正文用的那一档，且在正文约束之内", () => {
  const declared = read_declared_scale();
  const base = declared.get(default_level)!.size_rem;
  // 它是全应用最常用的档，动了就是全局字号变动。
  assert.equal(base, 0.875, `默认档 base 不是 0.875rem（14px）：${base}rem`);
  /*
   * `.markdown` 的段落间距是 0.5em，必须比消息块间距（gap-3 = 0.75rem）小至少 0.125rem：
   * `0.5 × 字号 ≤ 0.75 − 0.125` ⇒ 字号 ≤ 1.25rem。
   */
  assert.ok(base <= 1.25, `默认正文超过 xl（1.25rem），段落间距会顶到块间距：${base}rem`);
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

test("样式表里的字号只能引用语义令牌，或使用 em 相对值", () => {
  const violations: string[] = [];
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
 * 消息正文（`sm`）、Workspace 文档预览（`sm`）与 Power 说明（Power 自己的 `xs`），
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
      // 消息排版走共享常量（按角色两个：Agent 长文与用户气泡），它们内含 text-base。
      || /(?:chat|user)_message_text_class_name/.test(source);
    return !declares_size;
  }).map((file) => path.relative(renderer_root, file));

  assert.deepEqual(
    missing,
    [],
    `以下文件渲染了 Markdown 但没有声明字号，会静默继承祖先字号：\n  ${missing.join("\n  ")}\n`
      + "在包含 <Markdown> 的容器上加语义档位（或消息排版的 chat_message_text_class_name / user_message_text_class_name）。",
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
  const css = compiler.build([...third_party_only_levels.map((name) => `text-${name}`), "text-base"]);

  const generated = third_party_only_levels.filter((name) => has_declaration(css, `text-${name}`, "font-size"));
  assert.deepEqual(
    generated,
    [],
    `4xl 及以上的档位仍然能生成规则：${generated.map((name) => `text-${name}`).join(", ")}。\n`
      + "说明 tokens.css 的 `--text-*: initial` 失效了，应用里会同时存在两套字号体系。",
  );

  // 反向确认：本测试不是恒真的。
  assert.ok(has_declaration(css, "text-base", "font-size: var(--text-base)"), "语义档位在同一次编译里也生成不出规则，本测试无法证明任何事");
});
