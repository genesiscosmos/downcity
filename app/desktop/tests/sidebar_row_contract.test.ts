/**
 * 侧栏行契约的守卫。
 *
 * ## 被守的缺陷
 *
 * 侧栏曾经有 8 套各自实现的行（Chat 主体行、会话行、新建行、目录树行、Workspace 根行、
 * Power 目录条目、设置条目，以及注入给 Power 的 `SidebarItem` / `SidebarTreeItem`），
 * 每套自己决定行高、圆角、内边距、行首槽宽与文字档位。
 * 表现不是「某一处难看」，而是**同一类东西落不到一条线上**：以侧栏左缘起算，
 * 行文字分布在 80 / 84 / 88 / 94 / 96，行首图标分布在 64 / 66 / 70 / 72。
 *
 * 现在行只有**三个变体**，几何收在 `layouts/sidebar/sidebarRow.ts`，调用点只能引用：
 *
 * | 变体 | 行首槽 | 行高 | 文字线 |
 * | --- | --- | --- | --- |
 * | `agent` | 32 | 44 / 48 | 97 |
 * | `default` | 无、16 或 32 | 32 | 56 / 80 / 96 |
 * | `settings` | 16 | 40 | 80 |
 *
 * 本文件守住三件事：
 *
 * 1. **文字线**必须由「行盒起点 + 行内边距 + 边框 + 槽 + 间距」算出，不写死；
 * 2. **行高**必须容得下自己的槽，且只有三档；
 * 3. **没有第五个出口**：侧栏目录里除契约与卡片换算外不得出现行高字面量，
 *    且每个行实现都必须引用契约（含注入给 Power 的两个组件）。
 *
 * 断言源码而不是渲染结果：本仓库的测试不引入 DOM 环境（见 design_token_drift）。
 * 行为部分（展开方式、点外部收起等）由 subject_panel_mode.test.ts 单独验证。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const renderer_root = path.join(import.meta.dirname, "../src/renderer");
const sidebar_root = path.join(renderer_root, "layouts/sidebar");

const row_source = fs.readFileSync(path.join(sidebar_root, "sidebarRow.ts"), "utf8");
const shell_source = fs.readFileSync(path.join(renderer_root, "layouts/shellMotion.ts"), "utf8");

/** 读出 `export const NAME = <整数>;` 的值。 */
function read_number(name: string): number {
  const match = new RegExp(`export const ${name} = (\\d+);`).exec(row_source);
  assert.ok(match, `sidebarRow.ts 里找不到数值常量 ${name}`);
  return Number(match![1]);
}

/**
 * 求值一个导出的数值常量；它可以是字面量，也可以是若干常量相加。
 *
 * 派生常量（行盒起点、内容起点、卡片内文字线）都是回环相扣的，
 * 逐个展开而不是读一个写死的数——否则改公式不会失败，只有写新行时才会错位。
 */
function read_constant(name: string, depth = 0): number {
  assert.ok(depth < 6, `${name} 的展开层数过深：常量之间可能出现了循环引用`);
  const expression = new RegExp(`export const ${name} = ([^;]+);`).exec(row_source)?.[1];
  assert.ok(expression, `sidebarRow.ts 里找不到导出常量 ${name}`);
  return expression.split("+").reduce((total, raw) => {
    const term = raw.trim();
    if (/^\d+$/.test(term)) return total + Number(term);
    if (term === "SHELL_SIDEBAR_RAIL_WIDTH") return total + rail_width;
    if (term === "SIDEBAR_TEXT_INSETS.default") return total + 56;
    return total + read_constant(term, depth + 1);
  }, 0);
}

/** 读出 `export function NAME(...) { return <表达式>; }` 的返回表达式。 */
function read_return_expression(name: string): string {
  const match = new RegExp(`export function ${name}\\([^)]*\\)[^{]*\\{[\\s\\S]*?return ([^;]+);`).exec(row_source);
  assert.ok(match, `sidebarRow.ts 里找不到函数 ${name}`);
  return match![1]!.replace(/\s+/g, " ").trim();
}

/** Rail 宽度由 shellMotion 拥有（它与窗口 chrome 的关系见那里），这里只读它的值。 */
const rail_width = (() => {
  const match = /export const SHELL_SIDEBAR_RAIL_WIDTH = (\d+);/.exec(shell_source);
  assert.ok(match, "shellMotion.ts 里找不到 SHELL_SIDEBAR_RAIL_WIDTH");
  return Number(match![1]);
})();

/**
 * 契约数值表。
 *
 * 硬编码而不是从源码读出来再自比：从源码读的话，值被改成什么都测不出来。
 * 改成这里任何一项都会同时改变三条文字线，必须同步改这份表。
 */
const expected_values: readonly (readonly [string, number])[] = [
  ["SIDEBAR_CONTENT_PADDING", 8],
  ["SIDEBAR_ROW_PADDING", 8],
  ["SIDEBAR_ROW_BORDER", 1],
  ["SIDEBAR_LEADING_NONE", 0],
  ["SIDEBAR_LEADING_ICON", 16],
  ["SIDEBAR_LEADING_AVATAR", 32],
  ["SIDEBAR_ROW_TEXT_GAP", 8],
  ["SIDEBAR_TREE_INDENT", 12],
  ["SIDEBAR_TREE_CHEVRON", 24],
  ["SIDEBAR_TREE_ICON", 16],
  ["SIDEBAR_TREE_CHEVRON_GAP", 4],
  ["SIDEBAR_TREE_ICON_GAP", 4],
  ["SIDEBAR_PANEL_PADDING", 4],
  ["SIDEBAR_ROW_VERTICAL_PADDING", 4],
  ["SIDEBAR_COMPACT_ROW_PADDING", 4],
  ["SIDEBAR_CARD_BORDER", 1],
];

test("契约里的每个几何常量都是单一数值定义", () => {
  for (const [name, value] of expected_values) {
    assert.equal(read_number(name), value, `${name} 与契约不符：期望 ${value}。改值必须同步本文件的表与设计文档。`);
  }
});

test("行盒起点是「Rail + 内容内边距」", () => {
  assert.equal(
    read_return_expression("sidebar_item_content_inset"),
    "SIDEBAR_ITEM_CONTENT_INSET + (variant === \"agent\" ? SIDEBAR_ROW_BORDER : 0)",
    "行内容起点不是从行盒起点推出的：写死一个数就等于把推导过程删了",
  );
  assert.equal(read_constant("SIDEBAR_ROW_ORIGIN"), rail_width + 8, "行盒起点不再是 Rail + 内容内边距");
  assert.equal(read_constant("SIDEBAR_ITEM_CONTENT_INSET"), rail_width + 16, "行内容盒起点不再是行盒起点 + 行内边距");
});

test("文字线 = 内容起点 + 槽 +（有槽时的间距），且只有三条", () => {
  assert.equal(
    read_return_expression("sidebar_item_text_inset"),
    "sidebar_item_content_inset(variant) + leading + (leading === SIDEBAR_LEADING_NONE ? 0 : SIDEBAR_ROW_TEXT_GAP)",
    "文字线不再是「内容起点 + 槽 + 间距」：改任意一段都会跟着动，写成字面量就断了",
  );
  // 硬编码的验收值：这三条线是侧栏全部行的靶子。
  const expected: Readonly<Record<string, number>> = { agent: 97, default: 56, settings: 80 };
  for (const [variant, inset] of Object.entries(expected)) {
    const declared = new RegExp(`SIDEBAR_TEXT_INSETS[\\s\\S]{0,120}?${variant}: (\\d+)`).exec(row_source);
    assert.ok(declared, `SIDEBAR_TEXT_INSETS 里找不到 ${variant}`);
    assert.equal(Number(declared![1]), inset, `${variant} 变体的文字线变了：期望 ${inset}`);
  }
  assert.equal(read_constant("SIDEBAR_TREE_TEXT_INSET"), 100, "树形行的文字线变了");
  assert.equal(read_constant("SIDEBAR_PANEL_TEXT_INSET"), expected.default! + 1, "卡片内的 default 行文字线不是「default + 卡片描边」");
});

/**
 * 三条线必须与公式算出来的一致。
 *
 * 上一条钉的是「表里的数」，这一条钉的是「公式与表对得上」——分开写是因为
 * 只测其中一边都会漏：表对而公式错，写新行时照样会错位。
 */
test("三条文字线都能由公式复现", () => {
  const content_inset = (variant: string) => rail_width + 16 + (variant === "agent" ? read_number("SIDEBAR_ROW_BORDER") : 0);
  const text_inset = (variant: string, leading: number) => content_inset(variant) + leading + (leading === 0 ? 0 : read_number("SIDEBAR_ROW_TEXT_GAP"));
  assert.equal(text_inset("agent", 32), 97, "agent 变体的文字线");
  assert.equal(text_inset("default", 0), 56, "default 变体不带槽时的文字线");
  assert.equal(text_inset("settings", 16), 80, "settings 变体的文字线");
  assert.equal(text_inset("default", 32), 96, "default + 32 槽（若将来有这类行）的文字线");
  assert.equal(text_inset("default", 0) + read_number("SIDEBAR_CARD_BORDER"), 57, "卡片内 default 行的文字线");
  // 树行：default 行 + 箭头 + 图标（见「树行的箭头与图标尺寸」那条断言）。
  assert.equal(
    rail_width + read_number("SIDEBAR_CONTENT_PADDING") + read_number("SIDEBAR_COMPACT_ROW_PADDING") + read_number("SIDEBAR_TREE_CHEVRON") + read_number("SIDEBAR_TREE_CHEVRON_GAP") + read_number("SIDEBAR_TREE_ICON") + read_number("SIDEBAR_TREE_ICON_GAP"),
    100,
    "树形的文字线",
  );
});

/**
 * 卡片内外的文字同线：两层内边距之和必须相等。
 *
 * ```text
 * 卡片外：行内边距 8 + 边框 1                    = 9
 * 卡片内：卡片描边 1 + 面板内边距 4 + 行内边距 4  = 9
 * ```
 *
 * 因此文字仍在同一条线上，而底色（选中 / hover）缩回卡片内 4、文字离底色左缘也只剩 4。
 * 两层比例改错就会出现「底色贴边 + 内容离边很远」的双层皮——这正是这个等式要守的东西。
 */
test("卡片内外的文字同线：两层内边距之和相等", () => {
  const outside = read_number("SIDEBAR_ROW_PADDING") + read_number("SIDEBAR_ROW_BORDER");
  const inside = read_number("SIDEBAR_CARD_BORDER") + read_number("SIDEBAR_PANEL_PADDING") + read_number("SIDEBAR_COMPACT_ROW_PADDING");
  assert.equal(inside, outside, `卡片内 ${inside} ≠ 卡片外 ${outside}：卡片里的行会与外面的行错开`);
  assert.equal(read_constant("SIDEBAR_PANEL_TEXT_INSET"), 57, "卡片内的文字线变了");
  // 行自己的内边距必须比卡片外的行窄：卡片已经抱住了行，行再抩满就会变成双层皮。
  assert.ok(
    read_number("SIDEBAR_COMPACT_ROW_PADDING") < read_number("SIDEBAR_ROW_PADDING"),
    "卡片内行与卡片外行用了同样的左右内边距：底色会贴边而内容离边很远",
  );
});

/**
 * 树行的左右内边距必须与纵向同值（4），否则箭头在小方框里偏右。
 *
 * ```text
 * [pad 4][▶ 24]─gap 8─[📁 16]─gap 4─名称
 * ```
 *
 * 箭头 24（`size-6`）是它的**原始值**：一个小而完整的按钮，不是被压窄去迁就某个槽的图标。
 * 行 32 高、纵向内边距 4，因此箭头的上下各 4；左右也必须 4，它到四边的距离才相等。
 *
 * 这几个值加上行盒起点就是树形的文字线（100 + 12×depth），因此它们不能各自漂移。
 */
test("树行的箭头与图标尺寸是契约里的值，左右与纵向同值", () => {
  assert.equal(read_number("SIDEBAR_TREE_CHEVRON"), 24, "箭头的宽度变了（原为 size-6）");
  assert.equal(read_number("SIDEBAR_TREE_ICON"), 16, "节点图标的宽度变了");
  assert.equal(read_number("SIDEBAR_TREE_ICON_GAP"), 4, "图标与名字的间距变了");
  const expected = read_constant("SIDEBAR_ROW_ORIGIN") + read_number("SIDEBAR_COMPACT_ROW_PADDING") + read_number("SIDEBAR_TREE_CHEVRON") + read_number("SIDEBAR_TREE_CHEVRON_GAP") + read_number("SIDEBAR_TREE_ICON") + read_number("SIDEBAR_TREE_ICON_GAP");
  assert.equal(read_constant("SIDEBAR_TREE_TEXT_INSET"), expected, "树形的文字线不再等于「行盒起点 + 紧凑内边距 + 箭头 + 箭头间距 + 图标 + 图标间距」");
  assert.equal(read_constant("SIDEBAR_TREE_TEXT_INSET"), 100, "树形文字线的验收值变了");
  // 箭头必须是一个**完整的小按钮**：有悬停反馈与焦点环，而不是一条只能靠伪元素补命中区的窄缝。
  const disclosure = /sidebar_disclosure_class_name = "([^"]*)"/.exec(row_source)?.[1] ?? "";
  assert.ok(/\bsize-6\b/.test(disclosure), `箭头的尺寸不是 size-6（原样式）：${disclosure}`);
  assert.ok(/rounded-control/.test(disclosure), `箭头不是 rounded-control（原样式）：${disclosure}`);
  assert.ok(/hover:bg-interaction-hover/.test(disclosure), `箭头没有悬停反馈（原样式）：${disclosure}`);
  assert.ok(/focus-visible:ring-/.test(disclosure), `箭头没有焦点环：${disclosure}`);
  assert.ok(!/after:/.test(disclosure), `箭头又用伪元素补命中区了：它应该是 size-6 的完整按钮`);
  // 紧凑行的左右内边距必须等于纵向内边距——这是「箭头到四边距离相等」的唯一依据。
  assert.equal(
    read_number("SIDEBAR_COMPACT_ROW_PADDING"),
    read_number("SIDEBAR_ROW_VERTICAL_PADDING"),
    `紧凑行左右 ${read_number("SIDEBAR_COMPACT_ROW_PADDING")} ≠ 纵向 ${read_number("SIDEBAR_ROW_VERTICAL_PADDING")}：行首的小元素会偏一侧`,
  );
  assert.equal(
    read_number("SIDEBAR_TREE_CHEVRON") + read_number("SIDEBAR_COMPACT_ROW_PADDING") * 2,
    read_number("SIDEBAR_TREE_CHEVRON") + read_number("SIDEBAR_ROW_VERTICAL_PADDING") * 2,
    "箭头在行里的上下留白与左右留白必须一致",
  );
  // 箭头是一个 24px 的**按钮**，里面的字形只有 14px——左右各含 5px 内边距。
  // 因此它到图标之间要用更窄的间距：写普通行内间距（8）会让看得见的空白变成 13px。
  assert.ok(
    read_number("SIDEBAR_TREE_CHEVRON_GAP") < read_number("SIDEBAR_ROW_TEXT_GAP"),
    "箭头到图标用了普通行内间距：箭头盒自带 5px 内边距，空白会比别处宽一截",
  );
  assert.equal(
    read_number("SIDEBAR_TREE_CHEVRON") + read_number("SIDEBAR_TREE_CHEVRON_GAP") + read_number("SIDEBAR_TREE_ICON"),
    44,
    "「箭头盒 + 箭头间距 + 图标」的总宽变了",
  );
});

/**
 * 行只有**一条**渲染路径：行底是 `<div>`，可点的是里面的标签按钮。
 *
 * ## 为什么这条最重要
 *
 * 早先有两条分支（「整行一个按钮」与「行底 + 标签 + 操作位」），各自渲染一遍同样的东西。
 * 代价立刻显现，而且是两次：
 *
 * 1. 一条丢了 `w-full` → 按钮不填满父级，**底色只有字那么长**；
 * 2. 一条把标题与描述摆成了并排（父级是 `flex items-center`）→ **两个内容挤在一行**。
 *
 * 两次都是“同一段排版写了两遍，其中一遍错了”。现在只有一条路径，
 * 这两个错误在结构上就不可能再发生：底色与文字排版都只有一个来源。
 */
test("行只有一条渲染路径（不存在第二条分支）", () => {
  const item = fs.readFileSync(path.join(sidebar_root, "SidebarItem.tsx"), "utf8");
  const code = item.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
  // 不得再有“按条件返回两种结构”的写法。
  assert.ok(!/if \(!composite\) return/.test(code), "又出现了第二条渲染分支：两条会分叉");
  assert.ok(!/\bcomposite\b/.test(code), "又出现了 composite 判定：它说明结构又分成了两种");
  // 行底 + 标签按钮 + 操作位，且行底总是 SidebarRow。
  assert.match(code, /<SidebarRow variant=\{variant\}/, "行底不是唯一的 SidebarRow");
  assert.match(code, /<SidebarRowLabel/, "标签区不是共享的 SidebarRowLabel");
  // 行底只渲染一次。
  assert.equal([...code.matchAll(/<SidebarRow[\s>]/g)].length, 1, "行底被渲染了多次");
});

/**
 * 文字区是**一列**（标题一行、描述一行），而且只有一个来源。
 *
 * 标题与描述是两个块级元素；若父级是 `flex items-center`，它们会变成并排的 flex 项。
 * 现在这段排版只存在于 `SidebarRowTitleArea`，两个调用点都用它。
 */
test("标题与描述是两行，且只有一个来源", () => {
  const item = fs.readFileSync(path.join(sidebar_root, "SidebarItem.tsx"), "utf8");
  assert.match(item, /function SidebarRowTitleArea\(\{/, "没有共享的文字区组件");
  const area_start = item.indexOf("function SidebarRowTitleArea");
  const area_end = item.indexOf("</span>;", item.indexOf("return <span", area_start));
  const area = item.slice(area_start, area_end);
  assert.match(area, /return <span className="min-w-0 flex-1">/, "文字区的根不再是普通块级：标题与描述会被摆成一行");
  assert.ok(!/return <span className="[^"]*items-center[^"]*">/.test(area), "文字区自己成了 flex 行：标题与描述会并排");
  assert.match(area, /description \? <span className=\{cn\("mt-1/, "描述没有自己的行（或丢了 mt-1 间距）");
  // 只有一个定义，且被标签区使用。
  assert.equal([...item.matchAll(/function SidebarRowTitleArea/g)].length, 1, "文字区被定义了多次");
  assert.match(item, /<SidebarRowTitleArea title=\{title\}/, "标签区没用共享文字区");
});

/**
 * 行必须有 `w-full`（按钮不会像 div 那样填满父级）。
 *
 * 缩进不能挂在行自己身上：`w-full` + `marginLeft` 会把行盒推出容器右缘。
 * 两者是一对约束，去掉任何一个都会换来另一处错。
 */
test("行必须有 w-full，且缩进只出现在外层包裹上", () => {
  for (const name of ["sidebar_row_layout_class_name", "sidebar_compact_row_layout_class_name", "sidebar_tree_row_layout_class_name"]) {
    const value = new RegExp(name + " = `([^`]*)`").exec(row_source)?.[1] ?? "";
    assert.ok(value, "sidebarRow.ts 里找不到 " + name);
    assert.ok(/\bw-full\b/.test(value), name + " 丢了 w-full：按钮会缩到只剩内容宽（" + value + "）");
  }
  const item = fs.readFileSync(path.join(sidebar_root, "SidebarItem.tsx"), "utf8");
  const indent_uses = [...item.matchAll(/style=\{indent_style\}/g)].length;
  assert.equal(indent_uses, 1, `缩进样式出现 ${indent_uses} 处（应为 1 处，且在外层包裹上）`);
  assert.match(item, /return indent_style \? <div style=\{indent_style\}>\{row\}<\/div\> : row;/, "缩进那唯一一处不是外层包裹");
});

/**
 * 行首形状是**一个枚举**，不是三个布尔值。
 *
 * 三个布尔值（`leadingWidth` / `leadingAvatar` / `leadingTile`）能表达出
 * 「既是头像又是底块」这种不存在的组合，调用点还得知道哪个优先。
 */
test("行首形状是一个枚举，不是互斥的布尔值", () => {
  const item = fs.readFileSync(path.join(sidebar_root, "SidebarItem.tsx"), "utf8");
  assert.match(item, /leading_shape\?: SidebarLeadingShape/, "行首形状不是单一枚举参数");
  // 去掉注释再查：注释里会提到这几个已删的名字来解释为什么删。
  const code = item.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
  for (const dead of ["leadingWidth", "leadingAvatar", "leadingTile", "leadingSlot"]) {
    assert.ok(!new RegExp(dead).test(code), `SidebarItem 里还留着 ${dead}：形状应当只由一个参数表达`);
  }
  // 枚举三档都有定义。
  assert.match(row_source, /export type SidebarLeadingShape = "icon" \| "avatar" \| "tile";/, "形状枚举的定义变了");
});

/**
 * 图标位不传就不留位（没有 `reserve_icon` 这种开关）。
 *
 * 占位只在“同层里其它节点有图标”时才需要，而那种情况下调用点本来就该显式传占位节点。
 * 曾经有一个布尔开关让调用点声明“请留个空位”，结果 Skill / Task 整列多出 20px 空白。
 */
test("图标位不传就不留位（没有 reserve_icon 这种开关）", () => {
  const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
  for (const file of ["sidebarRow.ts", "SidebarItem.tsx"]) {
    const source = strip(fs.readFileSync(path.join(sidebar_root, file), "utf8"));
    assert.ok(!/reserve_icon/.test(source), `${file} 里又出现了 reserve_icon`);
  }
  const injected = strip(fs.readFileSync(path.join(renderer_root, "features/power/lib/PowerRendererComponents.tsx"), "utf8"));
  assert.ok(!/reserve_icon/.test(injected), "注入层又替 Power 决定了图标占位：Skill / Task 会重新多出一列空白");
  // 箭头位仍然自动占位（叶子与分支并列）。
  const item = strip(fs.readFileSync(path.join(sidebar_root, "SidebarItem.tsx"), "utf8"));
  assert.match(item, /: <span aria-hidden="true" className=\{sidebar_tree_chevron_placeholder_class_name\} \/>/, "叶子行不再自动占箭头位：它会与分支错开");
});

/**
 * 侧栏里的空态字号必须与行的文字档位同一量级。
 *
 * 踩过的坑：注入给 Power 的 `EmptyState` 把标题写死成 `text-base`（15px），
 * 而它同时服务于**侧栏与主区域**——于是 Power 侧栏的空态比它上面那些 12px 的行还重，
 * 看起来像一条“内容”，而不是“这里什么都没有”。
 *
 * 同一个组件在两个表面里的合适字号不同，因此它必须看得到自己在哪（`surface`），
 * 而不是一刀切。
 */
test("侧栏里的空态字号与行文字同量级（不写死 text-base）", () => {
  const injected = fs.readFileSync(path.join(renderer_root, "features/power/lib/PowerRendererComponents.tsx"), "utf8");
  assert.match(
    injected,
    /options\.surface === "sidebar" \? "text-xs" : "text-base"/,
    "EmptyState 的标题字号写死了：侧栏会用到主区域那一档（比行文字重）",
  );
  const own = fs.readFileSync(path.join(sidebar_root, "SidebarEmptyState.tsx"), "utf8");
  assert.match(own, /text-xs text-foreground/, "桌面侧栏空态的标题档位变了");
});


/**
 * 副文本与同级行的**文字**对齐，且比行描述再安静一档。
 *
 * 树行有两种文字线（有图标 / 无图标），副文本只能选一条。选“无图标”那一档：
 * 需要副文本的场景（空列表、加载中）恰好都是该层没有图标的那类。
 * 按“有图标”算会把它推到描述对象右边 20px。
 */
test("副文本对齐到“无图标”那一档文字线，且更安静", () => {
  const chevron_to_text = read_number("SIDEBAR_COMPACT_ROW_PADDING") + read_number("SIDEBAR_TREE_CHEVRON") + read_number("SIDEBAR_TREE_CHEVRON_GAP");
  // 紧凑内边距 4 + 箭头 24 + 行内间距 4（树行用 gap-1）= 32
  assert.equal(chevron_to_text, 32, "「行内到文字」的距离变了（4 + 24 + 4）");
  const indent = read_return_expression("sidebar_text_indent_style");
  assert.match(indent, /depth \* SIDEBAR_TREE_INDENT \+ SIDEBAR_COMPACT_ROW_PADDING \+ SIDEBAR_TREE_CHEVRON \+ SIDEBAR_TREE_CHEVRON_GAP/, "副文本的缩进公式变了");
  // 字号与颜色比行描述更轻。
  const sub = /sidebar_sub_text_class_name = "([^"]*)"/.exec(row_source)?.[1] ?? "";
  assert.match(sub, /text-3xs/, `副文本不是最安静的字号档：${sub}`);
  assert.match(sub, /text-subtle-foreground/, `副文本没有用“纯装饰”那一档弱化：${sub}`);
  const desc = /sidebar_row_description_class_name = "([^"]*)"/.exec(row_source)?.[1] ?? "";
  assert.match(desc, /text-2xs/, `行描述的字号档变了：${desc}`);
});

/**
 * 反例守卫：侧栏目录里不得再出现各自的行高字面量。
 *
 * 只允许两处：契约本身（定义三档），以及 `subjectCard.ts`（它在契约之上把 agent 带高
 * 换算成「卡片内容盒高度」，即那个 `calc(... − 2px)`）。其余任何地方写 `min-h-*`
 * 都意味着又长出了一套行——哪怕它「看起来只是这一处特殊」。
 */
test("行高字面量只允许出现在契约与卡片换算里", () => {
  const allowed = new Set(["sidebarRow.ts", "subjectCard.ts"]);
  const offenders: string[] = [];
  for (const entry of fs.readdirSync(sidebar_root)) {
    if (!/\.tsx?$/.test(entry) || allowed.has(entry)) continue;
    const source = fs.readFileSync(path.join(sidebar_root, entry), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    if (/\bmin-h-(8|9|10|11|12)\b/.test(source)) offenders.push(entry);
  }
  assert.deepEqual(offenders, [], `以下文件自己写了行高：${offenders.join(", ")}。行高属于契约，请在 sidebarRow.ts 里取。`);
});

/**
 * 三个变体必须真的被用上，且用在该用的地方。
 *
 * 这条防止「契约建好了但某处还在用旧写法」——那正是收敛最常见的失败方式。
 */
test("三个变体各有归属，且用途与设计一致", () => {
  const expect_variant = (file: string, variant: string, why: string) => {
    const source = fs.readFileSync(path.join(sidebar_root, file), "utf8");
    assert.ok(new RegExp(`variant="${variant}"`).test(source), `${file} 没有使用 ${variant} 变体：${why}`);
  };
  expect_variant("ChatSubjectList.tsx", "agent", "Chat 主体行是身份行，行首是头像");
  expect_variant("PowerSidebar.tsx", "agent", "Power 条目与 Chat 主体行同一档");
  expect_variant("SettingsSidebarPanel.tsx", "settings", "设置条目比 default 高一档");
  expect_variant("SubjectConversationsPanel.tsx", "default", "会话行是 default");
  expect_variant("WorkspaceSessionList.tsx", "default", "Workspace 会话列表是 default，带 32 槽");
  // 注入给 Power 的两个组件也要落在同一套变体上，否则同一个 Power 在两处会长得不一样。
  const injected = fs.readFileSync(path.join(renderer_root, "features/power/lib/PowerRendererComponents.tsx"), "utf8");
  assert.ok(/variant="agent"/.test(injected), "注入的 SidebarItem 不是 agent 变体：它会与 Power 目录页分叉");
  assert.ok(/variant="default"/.test(injected), "注入的 SidebarTreeItem 不是 default 变体");

  // 会话行**不带行首槽**：它没有头像也没有图标，放了会把文字从 56 推到 80/96。
  const sessions_panel = fs.readFileSync(path.join(sidebar_root, "SubjectConversationsPanel.tsx"), "utf8");
  assert.ok(!/leading(Slot)?=/.test(sessions_panel), "会话列表给行加了行首槽：文字线不再落在 56");
});
