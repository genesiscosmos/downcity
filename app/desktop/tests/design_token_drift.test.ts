/**
 * 设计令牌漂移守卫。
 *
 * 这套 UI 曾经在令牌层定义了 hover / selected / divider / scrim，
 * 但组件里各自手写了 `hover:bg-foreground/[0.035]`、`text-muted-foreground/60`、
 * `border-border/45` 这类任意值：同一件事最多出现 16 种写法，
 * 弱化文字有 80 处低于 3:1 对比度，顶栏高度用 px 导致界面缩放后两侧错位。
 *
 * 字号是同一类问题的另一个面：13 档字号（其中相邻档只差 0.5px）全靠调用点各自决定，
 * 于是无法收敛。这里把字号相关的写法一并列入禁用清单，
 * 完整的 9 级档位表与角色约定见 `font_scale.test.ts` 与 `docs/desktop-type-scale-design.md`。
 *
 * 逐条修完之后，这里守住底线：新代码不得再引入这些写法。
 * 需要新语义时，先在 styles/semantic-colors.css 里定义令牌，再引用它。
 *
 * 只扫描渲染层 tsx/ts；样式表里的 color-mix 已有确定性取值，另行治理。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const renderer_root = path.join(import.meta.dirname, "../src/renderer");

/** 禁止出现的写法与禁止理由。 */
const banned: readonly { rule: RegExp; why: string }[] = [
  { rule: /text-muted-foreground\/\d/, why: "次要文字只有一档；用 text-muted-foreground 或 text-subtle-foreground" },
  { rule: /text-foreground\/\d/, why: "正文只有一档；不要再叠透明度" },
  { rule: /bg-foreground\/\[/, why: "中性表面用 bg-surface-subtle / bg-surface-emphasis" },
  { rule: /bg-muted-foreground\//, why: "控件底色用 bg-control-surface / bg-control-track / bg-control-hover" },
  { rule: /border-border\/\d/, why: "描边只用 border-border / border-divider / border-border-subtle" },
  { rule: /divide-border\/\d/, why: "分隔线用 divide-divider / divide-border-subtle" },
  { rule: /hover:bg-primary\/|bg-primary\/\[0\./, why: "交互态用 interaction-hover / interaction-selected / interaction-active" },
  { rule: /text-\[\d+px\]/, why: "固定 px 字号不跟随界面缩放；用语义字号档位（text-3xs … text-3xl）" },
  // 字号收敛为 9 级语义档位后的底线（完整档位表见 `font_scale.test.ts`）：
  // 一、Tailwind 自带档位已被 `--text-*: initial` 清掉，写 4xl 及以上不会生成规则；
  // 二、任意值绕过档位收敛，而且 rem 任意值与语义档位长得一样却不受控。
  { rule: /\btext-(?:4xl|5xl|6xl|7xl|8xl|9xl)(?![\w-])/, why: "字号只有 3xs/2xs/xs/sm/base/lg/xl/2xl/3xl 九档；4xl 及以上已被清空，写了不会生效" },
  { rule: /text-\[[^\]]*(?:rem|px|em|pt|ch|ex|vh|vw|calc\()/, why: "字号只能取语义档位；要新档位先在 tokens.css 定义" },
  { rule: /bg-black\//, why: "遮罩用 bg-scrim / bg-scrim-strong" },
  { rule: /shadow-xl\b/, why: "阴影只有浮层（shadow-lg）与模态（shadow-2xl）两级" },
];

/** 递归收集渲染层需要扫描的文件。 */
function collect_files(directory: string, extensions = /\.tsx?$/): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full_path = path.join(directory, entry.name);
    if (entry.isDirectory()) return collect_files(full_path, extensions);
    return extensions.test(entry.name) ? [full_path] : [];
  });
}

test("渲染层不出现被收敛掉的任意令牌写法", () => {
  const violations: string[] = [];
  for (const file of collect_files(renderer_root)) {
    const relative = path.relative(renderer_root, file);
    fs.readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      // 注释里引用这些写法是为了解释为什么要避免它们，不算违规。
      const code = line.trim();
      if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return;
      for (const { rule, why } of banned) {
        if (rule.test(line)) violations.push(`${relative}:${index + 1} ${rule} → ${why}\n    ${code.slice(0, 120)}`);
      }
    });
  }
  assert.deepEqual(violations, [], `发现 ${violations.length} 处令牌漂移：\n  ${violations.join("\n  ")}`);
});

test("语义令牌层保留文字与遮罩的下限定义", () => {
  const tokens = fs.readFileSync(path.join(renderer_root, "styles/semantic-colors.css"), "utf8");
  for (const token of ["--interaction-hover", "--interaction-active", "--interaction-selected", "--divider", "--subtle-foreground", "--text-placeholder", "--scrim", "--scrim-strong", "--control-track"]) {
    assert.ok(tokens.includes(`${token}:`), `semantic-colors.css 缺少 ${token}`);
  }
});

/** 去掉注释，避免文档里的示例写法被当成真实代码。 */
function strip_comments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
}

test("跟随界面缩放的长度出口保持最小固定像素集合", () => {
  const shell = strip_comments(fs.readFileSync(path.join(renderer_root, "layouts/shellMotion.ts"), "utf8"));

  // pinned 部分就是不跟随界面缩放的那一段。除 0 与 1px 细线外，只允许引用具名常量，
  // 否则就是把按钮宽度、间距这类应用密度又钉成了物理像素。
  const pinned_literals = [...shell.matchAll(/pinned_px: (-?\d+)\b/g)].map((match) => Number(match[1]));
  const illegal_pinned = pinned_literals.filter((value) => ![0, 1, -1].includes(value));
  assert.deepEqual(illegal_pinned, [], `pinned_px 出现新的字面量：${illegal_pinned.join(", ")}`);

  // shell_px() 只允许包装窗口 chrome 常量或 0；定义行本身带类型标注，排除在外。
  const shell_px_arguments = [...shell.matchAll(/shell_px\(([^)]*)\)/g)]
    .map((match) => match[1]!.trim())
    .filter((argument) => !argument.includes(":"));
  const illegal_calls = shell_px_arguments.filter((argument) => !/^(SHELL_WINDOW_CHROME_LEFT|0)$/.test(argument));
  assert.deepEqual(illegal_calls, [], `shell_px() 出现新的固定像素来源：${illegal_calls.join(", ")}`);
});

test("每个已定义的语义令牌都真的被引用", () => {
  // 这条能抓到「定义了但没人用」的死令牌：`--surface-emphasis` 曾经就是这种状态，
  // 而它恰好是「在表面之上的表面」唯一合法的一档，没人用它意味着嵌套层级被压平。
  //
  // 比「同一行不重复出现同一令牌」那类启发式检查精确：后者会把同一行里的兄弟元素误判成嵌套
  // ——实测在新建 Agent / Group 页的一整行 JSX 上产生假阳性，信号被噪声淹没，因此已舍弃。
  const semantic_path = path.join(renderer_root, "styles/semantic-colors.css");
  const defined = [...fs.readFileSync(semantic_path, "utf8").matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((match) => match[1]!);
  assert.ok(defined.length >= 10, `只解析到 ${defined.length} 个令牌，解析方式可能已失效`);

  // 引用可能来自工具类（Tailwind 产物）或令牌映射（tokens.css）与基础样式（base.css），
  // 因此这里必须连 CSS 一起扫——只扫 ts/tsx 会把所有令牌都误判为未引用。
  const references = collect_files(renderer_root, /\.(tsx?|css)$/)
    .filter((file) => file !== semantic_path)
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  const unused = defined.filter((token) => !references.includes(`var(${token})`));
  assert.deepEqual(unused, [], `以下语义令牌已定义但没有任何引用：${unused.join(", ")}`);
});

/**
 * 自带可见键盘焦点指示的写法。
 *
 * 应用里 `*:focus-visible { outline: none }` 是全局关闭的，所以焦点必须由元素自己声明：
 * 要么直接写 focus-visible 工具类，要么使用已包含焦点样式的共享 class 常量。
 * 全局关闭本身是有意的（浏览器默认 outline 会与设计系统的 ring 叠成双重指示），
 * 但代价是「忘了写就等于键盘用户看不到自己在哪」——用测试把这个约束补回来。
 */
const focus_visible_idioms = [
  "focus-visible",
  "chat_row_trigger_class_name",
  "message_action_button_class_name",
  "mermaid_action_button_class_name",
  "mermaid_overlay_button_class_name",
  "menu_item_base_class_name",
  "menu_item_highlighted_class_name",
  "menu_item_interaction_class_name",
  "subject_session_row_class_name",
  // 侧栏的行几何与焦点指示收在 sidebarRow.ts 的契约里；引用契约的行同样算已声明。
  // 注意 `sidebar_item_base_class_name` **不在**名单里：它只提供行底（底色、高度、排版），
  // 环要由行内真正的按钮自己声明；引它不足以说明“这个按钮能有焦点”。
  "sidebar_item_class_name",
  "sidebar_row_focus_class_name",
  "sidebar_disclosure_class_name",
  "button_variants",
  "approval-action",
  "question-submit",
  "question-back",
  // 把交互挪到右侧面板的入口：焦点环在 chat.css 的 .interaction-panel-open:focus-visible。
  "interaction-panel-open",
  // 用户气泡的折叠开关：焦点环在共享常量里，不在 JSX 标签上。
  "user_message_collapse_button_class_name",
];

/** 按引号与花括号配对，取出一个 JSX 开标签的完整文本。 */
function read_tag(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    else if (character === ">" && depth === 0) return source.slice(start, index + 1);
  }
  return source.slice(start);
}

test("渲染层的每个 button 都声明了自己的键盘焦点指示", () => {
  const missing: string[] = [];
  for (const file of collect_files(renderer_root)) {
    if (!file.endsWith(".tsx")) continue;
    // 先去掉注释：组件文档里会写 `<button>` 举例（占位、嵌套限制…），
    // 但那是说明，不是真实代码。它会把这条断言变成一条只能靠“小心别在注释里提 button”来维系的规则。
    const source = strip_comments(fs.readFileSync(file, "utf8"));
    const relative = path.relative(renderer_root, file);
    let index = source.indexOf("<button");
    while (index !== -1) {
      const tag = read_tag(source, index);
      const line = source.slice(0, index).split("\n").length;
      if (!focus_visible_idioms.some((idiom) => tag.includes(idiom))) {
        missing.push(`${relative}:${line} → ${tag.replace(/\s+/g, " ").slice(0, 120)}`);
      }
      index = source.indexOf("<button", index + 7);
    }
  }
  assert.deepEqual(missing, [], `发现 ${missing.length} 个 button 没有焦点指示：\n  ${missing.join("\n  ")}`);
});

/**
 * 组件自己的 `<button>` 不能把环只写在调用点的类名常量里。
 *
 * `SidebarItem` 这类组件把行封装成了一件东西，于是它的焦点环必须由**组件自己**提供；
 * 上面那条按标签文本扫描的规则对这一点靠不住（它只看到类名常量的名字）。
 * 这里直接问：那个常量里到底有没有焦点样式。
 */
test("侧栏行组件自己提供了键盘焦点指示", () => {
  const row_source = fs.readFileSync(path.join(renderer_root, "layouts/sidebar/sidebarRow.ts"), "utf8");
  const focus = /sidebar_row_focus_class_name = "([^"]*)"/.exec(row_source);
  assert.ok(focus, "行契约里找不到 sidebar_row_focus_class_name");
  assert.ok(/focus-visible:ring-/.test(focus![1]!), `行契约的焦点常量没有焦点环：${focus![1]}`);
});

/**
 * 活动行里的两个数字标签共用同一个胶囊基类。
 *
 * 分组计数（`+N`）与改动行数（`+N -M`）在视觉上是同一种东西——“行尾的一个小数字标签”，
 * 几何必须一致。历史上它们各自写过一套属性，于是同一个胶囊有两组内边距与字号；
 * 本断言直接问：两边是否都引用了 `activity-tool-pill`。
 */
test("活动行的计数与改动标签共用同一个胶囊基类", () => {
  const activity = fs.readFileSync(path.join(renderer_root, "features/chat/components/messages/AgentActivity.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(renderer_root, "styles/chat.css"), "utf8");
  // 两个标签都必须带上基类，否则几何会各自漂移。
  assert.ok(activity.includes("activity-tool-pill activity-tool-count"), "分组计数没有引用胶囊基类");
  assert.ok(activity.includes("activity-tool-pill activity-tool-diff-stat"), "改动行数没有引用胶囊基类");
  // 基类必须真的提供胶囊几何，否则“引用”毫无意义。
  const base = /\.activity-tool-pill \{([^}]*)\}/.exec(styles);
  assert.ok(base, "chat.css 里找不到 .activity-tool-pill 的定义");
  for (const declaration of ["border-radius: 999px", "font-size: var(--text-3xs)", "padding:"]) {
    assert.ok(base![1]!.includes(declaration), `胶囊基类缺少 ${declaration}`);
  }
  // 修饰类不得再重复定义基类的几何（那正是漂移的起点）。
  for (const modifier of ["activity-tool-count", "activity-tool-diff-stat"]) {
    const rule = new RegExp(`\\.${modifier} \\{([^}]*)\\}`).exec(styles);
    if (!rule) continue;
    for (const duplicated of ["border-radius", "font-size", "padding:"]) {
      assert.ok(!rule[1]!.includes(duplicated), `.${modifier} 重复定义了基类的 ${duplicated}`);
    }
  }
});
