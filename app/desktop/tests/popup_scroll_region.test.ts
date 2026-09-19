/**
 * 浮层「圆角 + 滚动」的结构守卫。
 *
 * ## 被守的 bug
 *
 * 把 `overflow-y-auto` 加在**带圆角的表面**上时，滚动条会戳出圆角：滚动条属于该元素自身的
 * 绘制，浏览器只按矩形记账它在圆角处的溢出，顶部与底部明显露在外面（浅色主题下一眼可见）。
 * 圆角只对**后代**生效——`overflow-hidden` 的父层才会把子层裁剪成圆角。
 *
 * 正确结构（Select / Dialog 一直是对的，下拉菜单与两处后来新增的浮层曾破例）：
 *
 * ```
 * 表面：rounded + overflow-hidden        ← 只裁剪，不滚动、不带 padding
 *   └── 滚动区：overflow-y-auto + padding ← 真正滚动的内容
 * ```
 *
 * 这类错误不会报错、也不会警告，只表现为滚动条戳出圆角，因此用源码断言把它固定下来：
 *
 * 1. 共享样式里，表面必须裁剪、滚动区必须存在；
 * 2. 调用方不得把高度上限或 overflow 传给表面（那等于把滚动放回圆角表面）；
 * 3. 菜单的滚动区必须 `role="presentation"`（`role="menu"` 的直接子元素只能是菜单项）。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const renderer_root = path.join(import.meta.dirname, "../src/renderer");

/** 递归收集渲染层源文件。 */
function list_sources(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entry_path = path.join(directory, entry.name);
    if (entry.isDirectory()) return list_sources(entry_path);
    return /\.tsx?$/.test(entry.name) ? [entry_path] : [];
  });
}

/** 去掉注释，避免文档里的示例写法被当成真实代码。 */
function read_without_comments(file_path: string): string {
  return fs.readFileSync(file_path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

const menu_styles = read_without_comments(path.join(renderer_root, "components/ui/menu-styles.ts"));

/** 取出一条导出的类名常量值。 */
function read_class_name(source: string, name: string): string {
  const match = new RegExp(`${name} =\\s*\\n?\\s*"([^"]*)"`).exec(source);
  assert.ok(match, `menu-styles 里找不到 ${name}`);
  return match![1]!;
}

test("菜单表面只裁剪，不带 padding 也不滚动", () => {
  const surface = read_class_name(menu_styles, "menu_surface_class_name");
  assert.ok(surface.includes("overflow-hidden"), `菜单表面不再裁剪，滚动区会溢出圆角：${surface}`);
  assert.ok(!/overflow-y-auto|overflow-auto/.test(surface), `菜单表面自己滚动了，滚动条会戳出圆角：${surface}`);
  assert.ok(!/\bp-1\b|\bpx-\d|\bpy-\d/.test(surface), `菜单表面带 padding，改到滚动区去：${surface}`);
});

test("菜单滚动区承担滚动与 padding", () => {
  const scroll = read_class_name(menu_styles, "menu_scroll_class_name");
  assert.ok(scroll.includes("overflow-y-auto"), `菜单滚动区不滚动：${scroll}`);
  assert.ok(scroll.includes("p-1"), `菜单滚动区没有 padding，菜单会比以前贴边：${scroll}`);
  // 高度上限走视口可用高度，菜单不会长到超出窗口；未定义时回退，与 Select 一致。
  assert.ok(scroll.includes("--available-height"), `菜单滚动区没有按可用高度设上限：${scroll}`);
});

test("菜单滚动区对辅助技术隐藏", () => {
  // `role="menu"` 的直接子元素只应是 menuitem / group / separator；纯布局容器必须隐藏，
  // 否则读屏会把这一层当成菜单项。
  const menu_surface = read_without_comments(path.join(renderer_root, "components/ui/menu.tsx"));
  assert.match(menu_surface, /role="presentation"/, "MenuSurface 的滚动区没有 role=presentation");
});

/**
 * 真正的错误只有一个：**滚动的就是那个带圆角的元素**。
 *
 * 滚动条属于它所在元素自身的绘制，而圆角只对**后代**生效——两者落在同一元素上时，
 * 滚动条顶端/底端就会戳出圆角。所以分两条规则：
 *
 * 1. 同一个类名串里不得同时出现 `rounded-*` 与 `overflow-y-auto` / `overflow-auto`；
 * 2. 带圆角的浮层表面（由原语提供圆角）不得被传 `overflow-*`。
 *
 * `max-h-*` 为什么不查：它不把滚动放到表面上。表面 `max-h` + 内部滚动子是可行写法
 * （Popover 里两处模型选择器就是「表面 flex-col + 子元素 flex-1 overflow-auto」），
 * 把它也禁掉会把正确实现误判成违规，信号被噪声淹没。
 */
test("没有任何元素把滚动放在自己的圆角上", () => {
  const offenders: string[] = [];
  for (const file_path of list_sources(renderer_root)) {
    const relative = path.relative(renderer_root, file_path);
    const source = read_without_comments(file_path);
    // 规则 1：同一个类名串里既有圆角又有滚动。
    for (const match of source.matchAll(/"([^"\n]*(?:rounded-\w|rounded\b)[^"\n]*)"/g)) {
      const class_string = match[1]!;
      if (/overflow-(?:y-)?auto/.test(class_string)) offenders.push(`${relative} → 一个带圆角的类名串里出现了滚动：${class_string.slice(0, 100)}`);
    }
    // 规则 2：浮层表面自带圆角，调用方不得往表面上加滚动。
    for (const surface of ["DropdownMenuContent", "PopoverContent", "PreviewCard\\.Popup", "BaseSelect\\.Popup"]) {
      for (const match of source.matchAll(new RegExp(`<${surface}\\b[\\s\\S]{0,600}?>`, "g"))) {
        if (/overflow-(?:y-)?auto/.test(match[0])) offenders.push(`${relative} → 把滚动传给了自带圆角的 ${surface.replace("\\", "")}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `这些位置把滚动放在了圆角上，滚动条会戳出圆角：\n  ${offenders.join("\n  ")}`);
});

test("Select、Dialog 与 Popover 保持两层结构", () => {
  // 这几个是既有正确实现，被当作参照；改动它们时本测试会提醒重新检查结构。
  const select = read_without_comments(path.join(renderer_root, "components/ui/select.tsx"));
  assert.ok(/<BaseSelect\.Popup[\s\S]{0,600}?overflow-hidden/.test(select), "Select 表面不再裁剪");
  assert.ok(select.includes("overflow-y-auto"), "Select 的内层滚动区消失了");
  const dialog = read_without_comments(path.join(renderer_root, "components/ui/dialog.tsx"));
  assert.match(dialog, /DialogBody[\s\S]{0,200}?overflow-y-auto/, "DialogBody 不再是滚动层");
  const popover = read_without_comments(path.join(renderer_root, "components/ui/popover.tsx"));
  assert.ok(/Popover\.Popup[\s\S]{0,400}?overflow-hidden/.test(popover), "Popover 表面不再裁剪");
  assert.ok(!/overflow-y-auto/.test(popover), "Popover 表面自己滚动了，滚动条会戳出圆角");
});

test("列表型浮层把圆角与滚动分成两层", () => {
  // 待发送队列与模型详情卡都曾把 overflow 写在圆角上，是同源问题，一并守住。
  const queue = read_without_comments(path.join(renderer_root, "features/chat/components/MessageQueue.tsx"));
  assert.ok(/overflow-hidden rounded-surface/.test(queue), "待发送队列的外层不再裁剪圆角");
  assert.ok(/chat-queued-message-list max-h-32 overflow-y-auto/.test(queue), "待发送队列的滚动层不完整（滚动条样式类要跟着滚动层走）");
  const preview = read_without_comments(path.join(renderer_root, "features/chat/composer/ChatModelSelector.tsx"));
  assert.ok(/<PreviewCard\.Popup[\s\S]{0,400}?overflow-hidden rounded-surface/.test(preview), "模型详情卡的外层不再裁剪圆角");
  // 侧栏主体行展开出来的会话列表：卡片（在行组件内）负责圆角与裁剪，本层负责滚动。
  // 但**只有浮动态**是这样：嵌入态自己就是列表流里的一段，不包滚动容器（否则鼠标停在
  // 面板上就滚不动侧栏，见 SubjectConversationsPanel 的“滚动”一节）。
  const conversations_panel = read_without_comments(path.join(renderer_root, "layouts/sidebar/SubjectConversationsPanel.tsx"));
  assert.ok(/subject_panel_scroll_class_name = "max-h-80 overflow-y-auto overscroll-contain"/.test(conversations_panel), "浮动态的滚动层不完整（滚动条样式类要跟着滚动层走）");
  assert.ok(conversations_panel.includes("max-h-80"), "浮动态会话列表没有高度上限，长列表会漫出卡片");
  // 嵌入态不包滚动容器：它必须走“直接返回内容”那条分支。
  // 两边都上滚动容器就会造出一个鼠标滚轮被吃掉的死区。
  assert.ok(/return scrolls_itself \? <div className=\{subject_panel_scroll_class_name\}>\{content\}<\/div> : content;/.test(conversations_panel), "嵌入态还包着滚动容器：鼠标停在固定面板上会滚不动侧栏");
  assert.ok(/const scrolls_itself = max_visible === undefined;/.test(conversations_panel), "没有区分“要不要自己滚”");
  // 卡片负责圆角、描边与裁剪；面板自己再画一层就会叠成双层描边。
  // 裁剪是必要的：卡圆角 12px、面板内缩 8px、滚动条宽 5px，仅靠内缩挡不住滚动条最外 1px。
  // 边框用 border（卡片靠它读得出边界）、不用 inset-ring（多一圈线）；见 subjectCard。
  const card = read_without_comments(path.join(renderer_root, "layouts/sidebar/subjectCard.ts"));
  // 逐个查类名而不是抄一整串：类名顺序无意义，而这三件事缺一不可。
  const card_class_name = /const card_class_name = "([^"]*)"/.exec(card)?.[1] ?? "";
  for (const token of ["overflow-hidden", "rounded-surface", "border", "border-border"]) {
    assert.ok(card_class_name.split(/\s+/).includes(token), `卡片没有负责裁剪、圆角与描边：缺 ${token}（${card_class_name}）`);
  }
  assert.ok(!/rounded-floating-surface|border border-border/.test(conversations_panel), "会话列表自己又画了一层表面，会和卡片叠成双层描边");
});
