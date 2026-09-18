/**
 * 圆角角色表的守卫。
 *
 * ## 为什么需要这个文件
 *
 * 圆角此前是**半成品**：只有两个浮层别名（`rounded-floating-*`），其余 200 处裸用
 * Tailwind 原生档位，且同一个角色跨多档（容器跨 `lg`/`xl`/`2xl`，控件跨 `md`/`lg`/`xl`）。
 * 表现不是「某处圆角难看」，而是**无法回答「这里该用哪一档」**——与字号当初的病灶同类。
 *
 * 同时它带一个**真实缺陷**：CSS 里有 15 处 `border-radius` 用 px 字面量，
 * 而界面缩放是靠改写根字号实现的（rem 才跟随），所以那些圆角不随缩放变化。
 *
 * ## 这里守的最关键一条：`@theme` 与 `@theme inline` 的行为差异
 *
 * | 写法 | 是否发出运行时 `:root` 变量 | 能否在普通 CSS 里 `var()` |
 * | --- | --- | --- |
 * | `@theme` | ✅ 发出 | ✅ 可以 |
 * | `@theme inline` | ❌ 不发出（值只内联进工具类） | ❌ 不可以 |
 *
 * 圆角同时在两处消费：tsx 用工具类（`rounded-surface`），样式表用
 * `var(--radius-surface)`（如 `chat.css` 的 `.interaction-card`）。
 * 后者要求变量真的存在于 `:root`。若有人把角色表挪进 `@theme inline`，
 * 那些声明会**静默失效**——圆角变 0、不报错、类型检查也过。
 * 因此「角色令牌必须发出运行时变量」是本文件的第一条断言。
 *
 * 断言源码与编译产物，而不是渲染结果，是因为本仓库的测试不引入 DOM 环境。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { compile } from "tailwindcss";

const renderer_root = path.join(import.meta.dirname, "../src/renderer");
const styles_root = path.join(renderer_root, "styles");

const tokens_css = fs.readFileSync(path.join(styles_root, "tokens.css"), "utf8");
const theme_default_css = fs.readFileSync(path.join(styles_root, "theme/default.css"), "utf8");

/**
 * 契约：角色 → 值（rem）。
 *
 * 与 Tailwind 原生档位逐字节等值（`chip`=`sm` / `control`=`md` / `item`=`lg` /
 * `surface`=`xl` / `shell`=`2xl`）。这是**有意**的：圆角是视觉量，不另造数值阶梯。
 *
 * 硬编码而不是从源码读出来自比：从源码读的话，值被改成什么都测不出来。
 */
const expected_roles: readonly (readonly [string, string])[] = [
  ["chip", "0.25rem"],
  ["control", "0.375rem"],
  ["item", "0.5rem"],
  ["surface", "0.75rem"],
  ["shell", "1rem"],
];

/** 不参与角色表的一类：圆角是自身形状，不是层级表达（见设计文档 §4.6）。 */
const self_shaped_values = ["0", "999px", "50%"];

// ---------------------------------------------------------------------------
// Tailwind 编译工具
// ---------------------------------------------------------------------------

/** 定位 tailwindcss 包根。 */
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

/** 去掉注释，避免文档里的示例写法被当成真实代码。 */
function strip_comments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 收集样式表文件。 */
function style_files(): { name: string; source: string }[] {
  return fs.readdirSync(styles_root)
    .filter((name) => name.endsWith(".css"))
    .map((name) => ({ name, source: strip_comments(fs.readFileSync(path.join(styles_root, name), "utf8")) }));
}

// ---------------------------------------------------------------------------
// 1. 契约与运行时可用性
// ---------------------------------------------------------------------------

test("角色表恰好 5 个，值与契约一致，且全在 1/16rem 网格上", () => {
  for (const [role, value] of expected_roles) {
    const rule = new RegExp(`--radius-${role}:\\s*([^;]+);`).exec(tokens_css);
    assert.ok(rule, `tokens.css 缺少 --radius-${role}`);
    assert.equal(
      rule[1]!.trim(),
      value,
      `--radius-${role} 与契约不符：期望 ${value}，实际 ${rule[1]!.trim()}。\n`
        + "圆角角色映射 Tailwind 原生档位（不另造数值阶梯），改值必须同步本文件的契约表。",
    );
    // 1rem = 16px，0.0625rem = 1px，因此网格检查等价于「像素值是整数」。
    const rem = Number.parseFloat(value);
    assert.ok(Number.isInteger(rem / 0.0625), `--radius-${role}（${value}）不在 1/16rem 网格上`);
  }
  assert.equal(expected_roles.length, 5, "角色表是明确的设计要求：chip/control/item/surface/shell");
});

test("角色令牌必须发出运行时 :root 变量（不能写成 @theme inline）", async () => {
  const compiler = await compile_app_styles();
  const css = compiler.build(expected_roles.map(([role]) => `rounded-${role}`));
  const theme_layer = css.split("@layer base")[0]!;

  const not_emitted = expected_roles
    .filter(([role]) => !new RegExp(`--radius-${role}:`).test(theme_layer))
    .map(([role]) => role);

  assert.deepEqual(
    not_emitted,
    [],
    `以下角色令牌没有出现在 :root，因此样式表里的 var(--radius-*) 会解析为空（圆角变 0，且不报错）：\n  ${not_emitted.join(", ")}`,
  );

  // 反向确认：工具类也要真的生成（只发出变量、不生成工具类同样是坏的）。
  const utilities = (css.split("@layer utilities")[1] ?? "").split("@property")[0]!;
  const without_utility = expected_roles
    .filter(([role]) => !new RegExp(`\\.rounded-${role}(?![\\w-])`).test(utilities))
    .map(([role]) => role);
  assert.deepEqual(without_utility, [], `以下角色没有生成工具类：${without_utility.join(", ")}`);
});

/**
 * 角色表必须写在**普通** `@theme` 块里。
 *
 * ## 为什么光看「变量是否存在」不够
 *
 * 实测 Tailwind v4 的四象限行为：
 *
 * | 写法 | 发出 `:root` 变量 | 工具类 |
 * | --- | --- | --- |
 * | `@theme` + 字面量 | ✅ | `var(--radius-x)` |
 * | `@theme` + `var()` 引用 | ✅ | `var(--radius-b)` |
 * | `@theme inline` + 字面量 | ❌ | 字面量（内联） |
 * | `@theme inline` + `var()` 引用 | ✅ | `var(--radius-d)` |
 *
 * 但还有一个额外行为：**只要样式表里存在 `var(--radius-x)` 引用，Tailwind 就会把该变量保留下来**
 * （实测：inline + 字面量在“无 CSS 引用”时不发出、在“有 CSS 引用”时发出）。
 *
 * 而本项目的 `chat.css` / `base.css` 确实在用 `var(--radius-*)`，所以就算把角色表改成
 * `@theme inline`，上一条断言仍然会通过——它拦不住那个**依赖侥幸**的形式。
 * 那种形式本身不报错，但它的正确性建立在“别处恰好引用了这个变量”上，
 * 一旦那些引用改成工具类，变量就静默消失、圆角变 0。
 *
 * 所以这里额外做一条**源码级**断言：角色令牌必须声明在普通 `@theme` 块里。
 * 断言源码而不是产物，是因为两者的产物在当下完全一样——只能从写法上区分。
 */
test("角色表写在普通 @theme 块里，不依赖别处的 var() 引用侥幸存活", () => {
  /** 用花括号配对取出一段 @theme/@theme inline 块的头部与正文。 */
  const blocks: { header: string; body: string }[] = [];
  const source = strip_comments(tokens_css);
  for (const match of source.matchAll(/@theme\b[^{]*\{/g)) {
    const open = match.index! + match[0].length - 1;
    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          blocks.push({ header: match[0].slice(0, -1).trim(), body: source.slice(open + 1, index) });
          break;
        }
      }
    }
  }
  assert.ok(blocks.length >= 2, `只解析到 ${blocks.length} 个 @theme 块，解析方式可能已失效`);

  const role_names = expected_roles.map(([role]) => `--radius-${role}:`);
  const owning = blocks.filter((block) => role_names.some((name) => block.body.includes(name)));
  assert.equal(owning.length, 1, `角色令牌散落在 ${owning.length} 个 @theme 块里，应当只在一处定义`);

  assert.equal(
    owning[0]!.header,
    "@theme",
    `角色表被声明在「${owning[0]!.header}」里。\n`
      + "inline 会把值内联进工具类、不发出 :root 变量；本项目现在之所以还能跑，只是因为"
      + "chat.css / base.css 恰好引用了这些变量，Tailwind 因此把它们保留了——不要依赖这个侥幸。\n"
      + "请把圆角角色表放回普通 `@theme` 块。",
  );
});

/**
 * 反向确认：`@theme inline` + 字面量（且无 CSS 引用时）确实不发出运行时变量。
 *
 * 这条不是多余的：上一条断言（变量必须存在）在本项目里**同时**被两种因素满足——
 * 普通 `@theme` 发出变量，以及「样式表里引用了它所以被保留」。
 * 这里把 `inline` 单独放在一个无 CSS 引用的环境里，证明那个分支真的不发出变量，
 * 从而说明「必须写在普通 @theme 里」这条规则有实据。
 *
 * 如果这条失败，说明 Tailwind 的行为变了，本文件关于 `inline` 的结论需要重新推导。
 */
test("反向确认：@theme inline + 字面量不发出运行时变量（证明上面那条断言有效）", async () => {
  const compiler = await compile(
    '@import "tailwindcss";\n@theme inline { --radius-probe-inline: 0.5rem; }\n',
    {
      base: styles_root,
      loadStylesheet: async () => {
        const index_css = path.join(tailwind_root, "index.css");
        return { path: index_css, base: path.dirname(index_css), content: fs.readFileSync(index_css, "utf8") };
      },
    },
  );
  const css = compiler.build(["rounded-probe-inline"]);
  const theme_layer = css.split("@layer base")[0]!;
  assert.ok(
    !/--radius-probe-inline:/.test(theme_layer),
    "@theme inline + 字面量竟然发出了运行时变量：本文件关于 inline 的结论已失效，需重新核对实现",
  );
});

// ---------------------------------------------------------------------------
// 2. 样式表里的写法
// ---------------------------------------------------------------------------

test("样式表里不得用 px 字面量写圆角（界面缩放不生效）", () => {
  const violations: string[] = [];
  for (const { name, source } of style_files()) {
    source.split("\n").forEach((line, index) => {
      const match = /border-radius:\s*([^;]+);/.exec(line);
      if (!match) return;
      const value = match[1]!.trim();
      if (/^var\(--radius-/.test(value)) return;
      if (self_shaped_values.includes(value)) return;
      // 文档方言：相对宿主缩放（与字号的 em 同理，见 font_scale.test.ts）。
      if (/^[\d.]+em$/.test(value)) return;
      violations.push(`${name}:${index + 1} → border-radius: ${value}`);
    });
  }
  assert.deepEqual(
    violations,
    [],
    `样式表里出现了不受控的圆角写法：\n  ${violations.join("\n  ")}\n`
      + "只能写 var(--radius-<角色>)；自成一体的一类（滚动条、胶囊、圆点）写 0 / 999px / 50%；"
      + "文档方言样式表可以用 em。px 字面量不跟随界面缩放，是缺陷而不是风格问题。",
  );
});

test("样式表里不得出现阶梯外的圆角值", () => {
  // 曾经有一个 `--radius: 0.625rem`（10px）：不在 Tailwind 的档位表上（4/6/8/12/16），
  // 全库却只服务 1 处——「有且仅有一处用了特殊值」是最难解释的状态。已删除。
  assert.ok(
    !/^\s*--radius:\s*[^;]+;/m.test(theme_default_css),
    "`--radius: …`（无后缀）回归了：圆角取值只能来自角色表（--radius-chip … --radius-shell）。\n"
      + "若要它，先回答「它属于哪一层角色」，而不是造一个介于两档之间的值。",
  );
  assert.ok(!/\bvar\(--radius\)/.test(style_files().map((f) => f.source).join("\n")), "仍有 var(--radius) 引用");
});

// ---------------------------------------------------------------------------
// 3. 调用点
// ---------------------------------------------------------------------------

test("tsx 里不得裸用 rounded（它与 rounded-sm 同值）", () => {
  const collect = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return collect(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });

  const violations: string[] = [];
  for (const file of collect(renderer_root)) {
    fs.readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      const code = line.trim();
      if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return;
      // `rounded` 结尾（后面跟引号或空格），排除 rounded-sm / rounded-full 等。
      if (/(?<![\w-])rounded(?=["\s])/.test(line)) {
        violations.push(`${path.relative(renderer_root, file)}:${index + 1} ${code.slice(0, 100)}`);
      }
    });
  }
  assert.deepEqual(
    violations,
    [],
    `以下位置裸用了 rounded：\n  ${violations.join("\n  ")}\n`
      + "它与 rounded-sm 都是 0.25rem——两个名字一个值会让人以为两者有别。请改用角色名（rounded-chip）。",
  );
});

test("角色名与浮层别名不冲突（浮层别名等值于 surface / item）", () => {
  // `rounded-floating-surface` / `-item` 是同一套角色的早期版本，当时只覆盖了浮层。
  // 它们与 surface / item 等值，因此迁移到角色名是安全改名（Step 2）。
  const mapping: readonly (readonly [string, string])[] = [["floating-surface", "surface"], ["floating-item", "item"]];
  for (const [alias, role] of mapping) {
    const alias_rule = new RegExp(`--radius-${alias}:\\s*var\\(--radius-([a-z0-9]+)\\)`).exec(tokens_css);
    assert.ok(alias_rule, `tokens.css 里找不到 --radius-${alias} 的映射`);
    const target = expected_roles.find(([name]) => name === role)!;
    // floating-surface → radius-xl（0.75rem）= surface；floating-item → radius-lg（0.5rem）= item
    const tailwind_level = { surface: "xl", item: "lg" }[role as "surface" | "item"];
    assert.equal(
      alias_rule[1]!,
      tailwind_level,
      `--radius-${alias} 应指向 radius-${tailwind_level}（与 ${role} 等值），实际指向 radius-${alias_rule[1]}`,
    );
    assert.ok(target, `角色表缺少 ${role}`);
  }
});
