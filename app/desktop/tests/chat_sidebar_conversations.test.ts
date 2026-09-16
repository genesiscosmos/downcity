/**
 * @file Chat Sidebar 主体行与「会话列表归属」的守卫。
 *
 * ## 背景
 *
 * 侧栏原本是「主体列表 + 底部对话面板」：面板只能显示**当前选中**主体的对话，
 * 因此「看别的 Agent 有哪些对话」必须先切换选中；面板还吞掉了列表的垂直空间，
 * 并额外带来折叠状态、高度持久化与一根垂直把手。
 *
 * 现在会话列表是右侧按钮弹出的**浮层**：浮在侧栏之上、不占列表空间，
 * 里面是会话行（不是菜单项）。
 *
 * ## 为什么用 Popover 而不是 Menu
 *
 * 两者都是浮层，差别在语义：Menu 会把子元素固定成 menuitem，只允许一种外观与交互，
 * 会话行因此带不上自己的状态图标与当前项高亮。Popover 只提供「定位 + 开合 + 触发器 ARIA」，
 * 内容完全自由——这才是这里想要的。
 *
 * ## 为什么用源码断言
 *
 * 本仓库的测试不引入 DOM 环境（见 design_token_drift）；这里要守的是结构契约
 * （谁提供入口、谁拥有开合状态、用的是哪套浮层原语），源码就是它的事实源。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const renderer_root = path.join(import.meta.dirname, "../src/renderer");
const sidebar_root = path.join(renderer_root, "layouts/sidebar");

/** 读取渲染层文件，去掉注释——注释里会引用被移除的旧结构来解释为什么移除。 */
function read_without_comments(file_path: string): string {
  return fs.readFileSync(file_path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

const subject_list = read_without_comments(path.join(sidebar_root, "ChatSubjectList.tsx"));
const chat_sidebar = read_without_comments(path.join(sidebar_root, "ChatSidebar.tsx"));
const sessions_panel = read_without_comments(path.join(sidebar_root, "SubjectConversationsPanel.tsx"));

test("旧的面板式与下拉式入口都已移除", () => {
  // 留着它们就等于留下第二套会话入口，且两条路径会各自演化。
  // 注意 GroupSessionActionsMenu **不**在这个名单里：它是被复用的会话操作菜单，
  // 现在挂在会话浮层的每一行上（它曾因整个面板被删而闲置，这轮又被用起来了）。
  for (const removed of [
    "layouts/sidebar/ChatSessionPanel.tsx",
    "layouts/sidebar/SessionListItem.tsx",
    "layouts/sidebar/SubjectConversationsMenu.tsx",
  ]) {
    assert.ok(!fs.existsSync(path.join(renderer_root, removed)), `${removed} 仍然存在：对话列表会有两个来源`);
  }
  // 面板的折叠状态与高度不再有任何读取方。
  for (const key of ["downcity.chat_sessions_collapsed", "downcity.chat_sessions_height"]) {
    assert.ok(!chat_sidebar.includes(key) && !subject_list.includes(key), `仍有代码读取已废弃的 ${key}`);
  }
});

/**
 * 行的三个动作：头像推展开方式、名称+描述打开主体、右端菜单管主体操作。
 *
 * 名称与描述是**同一块**（沿用原本的实现：两者同在一个按钮里，整块都可点打开主体）；
 * 描述不是独立控件，因此行里只有三个交互目标，不多也不少。
 */
test("三个动作各占一处：头像推展开方式、名称+描述开主体、右侧管主体操作", () => {
  // 头像 → 推进展开方式（disclosure），且必须带可访问名称（头像是图标）。
  const disclosure = /aria-expanded=\{expanded\}[\s\S]{0,200}?aria-controls=\{expanded \? panel_id : undefined\}[\s\S]{0,400}?onClick=\{on_advance\}/.exec(subject_list);
  assert.ok(disclosure, "头像不是推进会话列表展开方式的按钮");
  assert.ok(/title=\{trigger_label\}[\s\S]{0,80}?aria-label=\{trigger_label\}/.test(subject_list), "头像开关没有可访问名称");

  // 名称 + 描述 → 打开主体。两者必须在同一个按钮里（原本的实现）。
  const open_block = /onClick=\{on_select\}[\s\S]{0,2000}?\{status_text \? <StatusText status=\{status\} text=\{status_text\} \/> : description\}/.exec(subject_list);
  assert.ok(open_block, "名称与描述不在同一个「打开主体」按钮里");
  assert.ok(/aria-current=\{active \? "page" : undefined\}/.test(subject_list), "该按钮没有表达当前项");

  // 右侧 → 主体操作菜单，且仍带行状态。
  assert.ok(/<RowMenuButton status=\{status\} label=\{menu_label\} \/>/.test(subject_list), "主体操作菜单不在行右端，或丢了行状态");

  // 行内只应有两个字面 button（头像、名称+描述），第三个目标是 RowMenuButton。
  // 数量多一个就说明描述又变成了独立控件（或被拆成了两个按钮）。
  const button_count = (subject_list.match(/<button\b/g) ?? []).length;
  assert.equal(button_count, 2, `行内字面 button 应为 2 个（头像 + 名称/描述），实际 ${button_count}`);
});

/**
 * 展开态必须是**一个元素**，不是 Portal 浮层 + 行的拼装。
 *
 * 这是本轮的核心回归点。Portal 浮层靠 JS 跟随锚点定位，而行在滚动容器里：
 * 滚动时浮层会有可见的滞后，「两张皮」当场就露了。
 *
 * 所以断言的是**同一棵子树**：卡片（边框、圆角、底色、行、列表）全在行组件内部，
 * 且不再有任何 Popover / Portal；上下的分界只是卡片内部的一段。
 */
test("展开卡片是一个元素，不是浮层拼装", () => {
  for (const forbidden of ["<Popover", "PopoverContent", "PopoverTrigger", "anchor=", "Portal"]) {
    assert.ok(!subject_list.includes(forbidden), `主体行又用上了 ${forbidden}：展开态会退回两棵子树`);
  }
  // 卡片、行、面板都是卡片元素的直接子节点；面板不是绝对定位的浮层。
  assert.ok(/<div ref=\{card_ref\} className=\{mode === "floating" \? subject_item_floating_class_name : subject_item_docked_class_name\}>/.test(subject_list), "找不到唯一的卡片元素（或它没有 ref，点外部判定就没有边界）");
  // 行内容在三个状态之间必须原样复用：各写一份迟早会走形。
  assert.ok(/const row_content = <>/.test(subject_list) && /\{row_content\}/.test(subject_list), "行内容没有在状态之间复用");
  const card = read_without_comments(path.join(sidebar_root, "subjectCard.ts"));
  assert.ok(/const card_class_name = `flex \$\{subject_row_height_class_name\} flex-col overflow-hidden rounded-lg border border-border bg-background`/.test(card), "卡片本体不是单个纵向容器，或丢了边框");
  assert.ok(/subject_card_panel_class_name = "shrink-0"/.test(card), "卡片下半不是卡片内的普通流子节点");
  // 卡片两半在同一个流里，因此不存在“接缝对齐”这件事。
  assert.ok(!/subject_card_(top|bottom)_style/.test(subject_list + card), "又出现了拆分接缝的样式辅助：说明卡片又被拆成两个盒子了");
});

/**
 * 浮动与嵌入的差别只有一处：**卡片在不在文档流里**。
 *
 * - 浮动：槽位撑住行在列表里的位置（后面的主体不会因浮动而移动），卡片绝对定位于它、
 *   向下浮在后续行之上，靠 `shadow-lg` 说明自己压着别人；
 * - 嵌入：卡片自己就是那一行，占高度、把后续主体推开，因此不需要槽位，也不该有阴影。
 *
 * 两者同在一个滚动容器里，所以滚动时永远一起走。
 */
test("浮动压在列表上，嵌入留在列表流里", () => {
  const card = read_without_comments(path.join(sidebar_root, "subjectCard.ts"));
  assert.ok(/subject_slot_class_name = `relative \$\{subject_row_height_class_name\}`/.test(card), "槽位没有占住行高，浮动时后面的主体会被挤走");
  assert.ok(/subject_item_floating_class_name = `absolute inset-x-0 top-0 z-20 \$\{card_class_name\} shadow-lg`/.test(card), "浮动态不是相对槽位绝对定位，或没有抬到后续行之上");
  assert.ok(/subject_item_docked_class_name = card_class_name;/.test(card), "嵌入态与浮动态不是同一个卡片盒子，两态之间行内容会跳");
  assert.ok(!/subject_item_docked_class_name = `[^`]*absolute/.test(card), "嵌入态还在绝对定位：它会脱离列表流，后续主体不会被推开");
  // 阴影是两种展开态唯一的即时区别，不能省也不能反过来给。
  assert.ok(/subject_item_docked_class_name = card_class_name;/.test(card) && !/subject_item_docked_class_name = `[^`]*shadow/.test(card), "嵌入态带上了阴影：它与浮动态在视觉上无从分辨");
  // 槽位与边框盒共用一个高度常量；两处各写一遍就会错位。
  assert.ok(/subject_row_height_class_name = "min-h-12"/.test(card), "行高没有集中定义");
});

/**
 * 会话列表由**行自己渲染**，不经由外部拼好一个节点再传进来。
 *
 * 早先的写法是多层之间传 `panel={<SubjectConversationsPanel … />}`：节点在离使用处两层的地方
 * 拼装、再当做一个不透明属性往下透，于是 `panel` / `panel_label` / `subject_name` 一路
 * 传的是同一件事的三种形式，而“行里长着什么”在行的代码里反而看不到。
 * 现在行直接收数据（`conversations`）、自己渲染列表，读一行就知道它展开后是什么。
 */
test("会话列表由行自己渲染，不经由外部注入节点", () => {
  // 只禁「作为属性透传」，不禁局部变量名：行内部自己算一个变量是正常的。
  for (const prop of ["panel", "panel_label", "subject_name"]) {
    assert.ok(!new RegExp(`\\b${prop}=\\{`).test(subject_list), `又出现了 ${prop} 属性透传：行的展开内容应该在行自己的代码里`);
  }
  assert.ok(/<SubjectConversationsPanel conversations=\{conversations\}/.test(subject_list), "行没有自己渲染会话列表");
  assert.ok(/conversations: readonly SubjectConversation\[\]/.test(subject_list), "行的入参里没有会话数据");
});

/**
 * 点外部收起与 Esc 都**只作用于浮动态**，且与“固定”无关。
 *
 * 浮动会盖住它下面的行，所以默认必须是「点开外部就收起」，否则用户想点被盖住的行时
 * 只能先想办法把面板关掉。嵌入态不挂这些监听，而是因为它的**前提不再成立**：
 * 卡片已经在列表流里，没有盖住任何东西。
 *
 * 这同时避掉一个真问题：多个嵌入面板各持一份 document 监听时，一下 Esc 会把所有固定
 * 面板一起关掉——而那正是“嵌入态相互独立”要防的事。
 */
test("点外部收起与 Esc 只挂在浮动态", () => {
  assert.ok(/if \(mode !== "floating"\) return;/.test(subject_list), "收尾手势没有限定在浮动态");
  assert.ok(/addEventListener\("pointerdown"/.test(subject_list), "缺少点外部收起（浮动的卡片会盖住下面的行）");
  assert.ok(/card_ref\.current\?\.contains/.test(subject_list), "点外部判定没有排除卡片自身");
  assert.ok(/removeEventListener\("pointerdown"/.test(subject_list), "监听没有清理，会泄漏");
  assert.ok(/event\.key !== "Escape"/.test(subject_list), "缺少 Esc 关闭");
  assert.ok(/removeEventListener\("keydown"/.test(subject_list), "Esc 监听没有清理，会泄漏");
  // 嵌入态不该有任何 document 级收尾监听：多个面板会互相踩。
  assert.ok(!/if \(mode === null\) return;[\s\S]{0,300}?addEventListener/.test(subject_list), "折叠/嵌入态也挂了收尾监听");
});

/**
 * 嵌入是“整块塞进列表流”，而行可能本来就贴着列表底部。
 *
 * 那一瞬间只有行自己变了形，列表一屏都动，点击会看起来像没反应。
 * 补一点滚动就够；用 `scrollIntoView` 不行：卡片比滚动区高时它会按“最近边”对齐，
 * 可能把整列主体一下翻上去，反而让人丢失自己刚才在哪。
 */
test("嵌入后把卡片补进可视区，且只补底部溢出", () => {
  assert.ok(/mode !== "docked"/.test(subject_list), "嵌入后没有处理可视区");
  assert.ok(/data-sidebar-scrollable/.test(subject_list), "没有找到侧栏滚动容器（它会随布局重构换名字）");
  assert.ok(/scroller\.scrollTop \+= overflow/.test(subject_list), "没有补上底部溢出，贴底的卡片嵌入后会整块留在屏幕外");
  assert.ok(!/scrollIntoView/.test(subject_list), "又用上了 scrollIntoView：卡片比滚动区高时会整块跳");
});

/**
 * 固定开关是一个**切换按钮**：状态走 `aria-pressed`，名称保持稳定。
 *
 * 把名称改成「取消固定」会让读屏每次都听到不同的控件名；
 * 正确做法是名称固定、状态交给 `aria-pressed`。
 */
test("固定开关用 aria-pressed 表达状态", () => {
  assert.ok(/aria-pressed=\{pinned\}/.test(sessions_panel), "固定开关没有暴露按下状态");
  assert.ok(/pinned \? <TbPinFilled \/> : <TbPin \/>/.test(sessions_panel), "固定开关的图标不区分状态");
  assert.ok(/on_toggle_pinned\(!pinned\)/.test(sessions_panel), "固定开关没有上报切换");
  assert.ok(sessions_panel.includes("sidebar.keep_open"), "固定开关没有可访问名称");
  // 固定与「嵌入」是同一个信号：按下 = 嵌入，抬起 = 回浮动。
  assert.ok(/const pinned = mode === "docked"/.test(subject_list), "固定的判定没有落到嵌入态上");
  assert.ok(/on_toggle_pinned=\{\(next\) => on_open_change\(next \? "docked" : "floating"\)\}/.test(subject_list), "固定开关没有对应到展开方式上");
  // 面板本身不应该因为固定而把自己渲染成别的语义（它不是 dialog）。
  assert.ok(!/aria-haspopup/.test(subject_list), "展开区域不该声明为弹出层");
});

/**
 * 「新建对话」固定在**顶部**，不再随会话数量上下浮动。
 *
 * 它是这一层的首要动作（进来通常就是为了开一个新的），因此与列表分居两段。
 */
test("新建对话在列表顶部", () => {
  const new_chat_index = sessions_panel.indexOf('title={translate("sidebar.new_chat")}');
  const list_index = sessions_panel.indexOf("conversations.map(");
  assert.ok(new_chat_index !== -1 && list_index !== -1, "找不到新建入口或会话列表");
  assert.ok(new_chat_index < list_index, "新建对话不在列表之前：它又跑到列表底部去了");
  assert.ok(!/conversations\.map\([\s\S]*?title=\{translate\("sidebar\.new_chat"\)\}[\s\S]*?<\/div>\s*$/.test(sessions_panel), "列表底部还留着第二个新建入口");
});

/**
 * 浮层锚在**整行**上，与行等宽——“整个 item 展开”，而不是从图标上挂下来的下拉菜单。
 *
 * 锚点决定位置与 `--anchor-width`：只要还锚在右侧那个小按钮上，面板就会又窄又偏、
 * 一看就是 dropdown。这条锁住三件事：锚点是行元素、对齐到行的左缘、宽度取锚点宽度。
/**
 * 卡片与行必须共用几何：行高与内边距各只有一个定义。
 *
 * 这一条曾经很重要——当时卡片是「行 + Portal 浮层」两个盒子，靠把两半的圆角与内边距
 * 对齐来假装成一张卡，而它们真的分叉了（行顶角 8px + 面板底角 12px、内边距 6px 对 4px）。
 * 现在两半在同一个元素里，接缝已不存在；但**内边距仍必须同源**，否则面板里的会话行
 * 会与头像左缘错开；行高也必须同源，否则槽位会与行错位。
 */
/**
 * 折叠与展开必须落在同一个位置：**内容居中**在 48px 的带子里，两个状态的「内容盒」都得是 46px。
 *
 * ```
 * 折叠：行 = min-h-12 + 透明边框      → 内容盒 46px（边框吃掉 2px）
 * 展开：卡片 1px 边框 + 行 min-h-(3rem−2px) → 行内容盒 46px
 * ```
 *
 * 展开态行若写回 48px，会多出 2px、内容被推低——这是这套几何唯一的坑，因此锁住。
 * 位置不靠把内容撑满整条带子得到（那样会改掉行的纵向节奏、名称与描述贴住上下缘）。
 */
test("折叠与展开的内容盒同高，内容居中在同一位置", () => {
  const card = read_without_comments(path.join(sidebar_root, "subjectCard.ts"));
  // 边框两个状态是同一条：折叠透明、展开可见。只剩一边会让内容盒高度不同。
  assert.ok(/subject_item_collapsed_class_name = `[^`]*border border-transparent/.test(card), "折叠态没有占位的透明边框");
  assert.ok(/const card_class_name = `[^`]*border border-border/.test(card), "展开的卡片没有边框");
  assert.ok(!card.includes("inset-ring"), "卡片又画上了 ring");

  // 带子 48px；展开时行在卡片内部，退回 46px（缩放后的带高 − 两条钉住的边框线）。
  assert.ok(/subject_row_height_class_name = "min-h-12"/.test(card), "带子总高没有集中定义");
  assert.ok(/subject_row_expanded_height_class_name = "min-h-\[calc\(3rem-2px\)\]"/.test(card), "展开态的行没有退回卡片内容盒高度，内容会被推低 2px");
  assert.ok(/subject_row_class_name = `\$\{row_layout_class_name\} \$\{subject_row_expanded_height_class_name\} shrink-0`/.test(card), "展开态的行没有引用那份高度");
  // 纵向内边距不能省：它是居中计算的一部分（内容 34px + py-1 = 42px，居中在 46px 里）。
  assert.ok(/const row_layout_class_name = "group\/item flex items-center gap-2\.5 px-1\.5 py-1"/.test(card), "行内容丢了纵向内边距或间距");
  // 名称/描述不做成撑满的两行（那会改掉行的纵向节奏）。
  assert.ok(!card.includes("min-h-6"), "又出现了把两行撑满的写法");
});
/**
 * 卡片常驻，但**列表只在展开时渲染**。
 *
 * 折叠态直接返回行本身，**连槽位与卡片都不渲染**——这是绝大多数行的状态，
 * 它的 DOM 必须与普通列表行一致。
 *
 * 早先两种写法都错过：先是不判断就渲染列表（折叠的行溢出一整列会话），
 * 后来又把卡片常驻给每一行（每行多背一层绝对定位 + overflow-hidden 的包裹）。
 */
test("折叠态不渲染卡片与列表，但保留行盒子", () => {
  assert.ok(/if \(mode === null\) return <div className=\{cn\(subject_item_collapsed_class_name/.test(subject_list), "折叠态没有提前返回：会多渲染卡片与列表");
  assert.ok(/\{row_content\}<\/div>\s*<div id=\{panel_id\}/.test(subject_list), "展开态没有把行内容与列表放进同一个卡片里");
  // 槽位只服务于浮动：嵌入时卡片自己就占着那一行，再包一层只是白多一层布局。
  assert.ok(/return mode === "floating" \? <div className=\{subject_slot_class_name\}>\{card\}<\/div> : card;/.test(subject_list), "槽位没有限定在浮动态");
});

/**
 * 触发器现在是我们自己的按钮，因此 aria 必须自己写。
 *
 * 早先这块由 Base UI 的 Popover 代劳，那时手写反而会重复声明；改成自绘之后
 * **不写就等于没写**——读屏不会知道这一行可以展开。
 * （这个测试与上一条构成一对：谁承担 ARIA 随结构变化，不能两边都错。）
 */
test("触发器自己声明展开语义", () => {
  assert.ok(/aria-expanded=\{expanded\}/.test(subject_list), "触发器没有暴露开合状态");
  // 折叠时那个面板还没在文档里；指向不存在的 id 是无效引用，因此只在展开时给。
  assert.ok(/aria-controls=\{expanded \? panel_id : undefined\}/.test(subject_list), "触发器没有指向它控制的列表（或折叠时指向了不存在的面板）");
  assert.ok(/id=\{panel_id\}/.test(subject_list), "被控制的列表没有可引用的 id");
  // useId 而不是写死：同一列表里有多行，写死的 id 会重复。
  assert.ok(/useId\(\)/.test(subject_list), "面板 id 是写死的，多行会重复");
  // 不再是 dialog / 菜单，因此不应该残留 aria-haspopup。
  assert.ok(!/aria-haspopup/.test(subject_list), "展开按钮不该声明为弹出层：它是一段展开的内容");
});

/**
 * 开合状态归 ChatSidebar，且是「一个浮动 + 一组嵌入」，不是「一个 key」。
 *
 * 存一个 key 就只能同时开一个面板——那对浮动是对的（它绝对定位、会盖住下面的行），
 * 对嵌入是错的：嵌入在列表流里各占一段，本来就该能并存。
 *
 * 状态放在行内同样不行：两行各记一个布尔值，两行自以为独立，而列表层不知道到底开了几个，
 * 投影与会话计数就都对不上。
 *
 * 不变量（浮动至多一个、同一 key 不重复）由 subjectCard 的纯函数维持，组件只负责调用；
 * 行为本身由 tests/subject_panel_mode.test.ts 独立验证。
 */
test("开合由 ChatSidebar 拥有，嵌入可多个并存", () => {
  assert.ok(/const \[stored_panels, set_open_panels\] = useState<OpenPanels>\(no_open_panels\)/.test(chat_sidebar), "开合状态不在 ChatSidebar，或不是 OpenPanels");
  assert.ok(/retain_open_panels\(stored_panels, subjects\.map/.test(chat_sidebar), "没有校验展开的主体是否还在列表里");
  // 推进与设置都走纯函数；组件里不再自己算不变量。
  assert.ok(/advance_open_panels\(current, key\)/.test(chat_sidebar), "头像推进没有走纯函数");
  assert.ok(/set_open_panel_mode\(current, key, mode\)/.test(chat_sidebar), "展开方式的设置没有走纯函数");
  // 独立的 pinned 布尔值只能描述一个面板，且能表达出「没展开但已固定」这种不存在的组合。
  assert.ok(!/pinned/.test(chat_sidebar), "ChatSidebar 又出现了独立的 pinned 布尔值");
  // 受控：行只上报意图，不自己持有状态。
  assert.ok(/mode: SubjectPanelMode \| null;/.test(subject_list), "行没有从上层接收展开方式");
  assert.ok(/mode=\{mode\}/.test(subject_list), "列表没有把展开方式交给行");
  assert.ok(/onClick=\{on_advance\}/.test(subject_list), "头像没有把意图上报给上层");
});

/**
 * 会话列表的滚动条要贴在卡片右缘，所以**水平内边距不能放在滚动容器上**。
 *
 * 滚动条的横向位置由滚动容器自身的盒子决定：容器带 `px-*` 时滚动条会被一起推内，
 * 看上去像悬浮在列表中间。行自己带 `px-2` 做内容内缩即可，外面再加一层就是双层间距
 * （用户的原话是「padding 很怪异」）。
 *
 * 底部留白则相反：它必须在滚动区**内部**，跟着内容滚，也就不会影响滚动条的水平位置。
 */
test("内边距给列表内容而不是滚动容器：滚动条因此贴边", () => {
  const card = read_without_comments(path.join(sidebar_root, "subjectCard.ts"));
  // 卡片下半的容器不带内边距（它只是卡片流里的一个子节点）。
  assert.ok(/subject_card_panel_class_name = "shrink-0"/.test(card), "面板容器带上了内边距");

  // 滚动容器：铺满宽度、**不带内边距**——内边距放在它身上会把滚动条从卡片右缘推内。
  const scroll_tag = /export const subject_panel_scroll_class_name = "(max-h-80 overflow-y-auto overscroll-contain)";/.exec(sessions_panel);
  assert.ok(scroll_tag, `找不到浮动态的滚动容器，或它带上了额外样式：${sessions_panel.slice(0, 200)}`);
  assert.ok(!/\b(p[xltrby]?|pl|pr|pt|pb)-/.test(scroll_tag[1]!), `滚动容器带上了内边距，滚动条不会贴边：${scroll_tag[1]}`);

  // 列表内边距在滚动容器**内部**的包装层上。嵌入态没有滚动容器，但它仍在内容那一层。
  assert.ok(/<div className="p-1">/.test(sessions_panel), "列表内容没有自己的内边距，或它不在滚动容器内部");
  // 行的文字内缩仍由行自己承担。
  assert.ok(sessions_panel.includes('subject_session_row_class_name = "flex min-h-7 w-full items-center gap-1.5 rounded-md px-2'), "会话行没有自己的文字内缩");
});

/**
 * 展开后的卡片是一张**白底卡**：上下两半同色，不能在一张卡内部出现色差。
 *
 * 曾经的 bug 很具体：卡片铺了 `bg-background`（白），而「当前 Agent」那一行又按折叠态的
 * 语言给自己上了一次选中底色（`bg-interaction-selected` = 前景 10%）——于是同一个盒子里
 * 上半灰、下半白，读起来又是两块。展开态不需要选中底色，因为“卡片开着”本身就是证据。
 *
 * 折叠态保留选中底色：那是列表一直以来的语言，也是用户判断“我在哪个 Agent”的依据。
 * 悬停反馈两种状态都保留（瞬时反馈，且只落在行上，不会染到列表）。
 */
test("展开后上下两半同底色：行内不再上选中底色", () => {
  const card = read_without_comments(path.join(sidebar_root, "subjectCard.ts"));
  // 卡片负责铺底。
  assert.ok(/const card_class_name = `[^`]*bg-background`/.test(card), "展开的卡片没有铺底色");

  // 行内容的底色必须按展开态分流。
  const branch = /const interaction_class_name = expanded\s*\n?\s*\? "([^"]*)"\s*\n?\s*: active \? "([^"]*)"/.exec(subject_list);
  assert.ok(branch, `行内容底色没有按展开态分流：${subject_list.slice(subject_list.indexOf("interaction_class_name ="), subject_list.indexOf("interaction_class_name =") + 160)}`);
  assert.ok(!branch[1]!.includes("bg-interaction-selected"), `展开态的行仍在上选中底色，会在卡片内切出色差：${branch[1]}`);
  assert.ok(branch[1]!.includes("hover:bg-interaction-hover"), `展开态的行丢了悬停反馈：${branch[1]}`);
  // 折叠态保留选中底色。
  assert.ok(branch[2]!.includes("bg-interaction-selected"), `折叠态丢了选中底色：${branch[2]}`);

  // 面板自己不铺底（否则又会与卡片叠一层，深浅不一）。
  assert.ok(!/bg-(background|muted|surface-subtle)/.test(sessions_panel), "面板自己铺了底色，会与卡片叠成两层");
});

test("会话行的切换与菜单各管一件事", () => {
  // 会话行的首要动作仍然是「切换过去」，且必须一次点击完成。
  assert.ok(/conversation\.select\(\); close\?\.\(\)/.test(sessions_panel), "会话行不再一键切换");
  assert.ok(sessions_panel.includes("sidebar.new_chat"), "会话列表缺少新建入口：空列表会变成死路");
  assert.ok(sessions_panel.includes("sidebar.no_sessions"), "会话列表缺少空态文案");
  assert.ok(sessions_panel.includes('aria-current={conversation.active ? "true" : undefined}'), "会话行没有表达当前项");
  // 菜单由调用方构造，面板只给它一个位置：面板因此不需要认识 Session 目录，
  // 也不需要知道两个主体的菜单不一样（Agent 有归档与复制路径，Group 没有）。
  assert.ok(sessions_panel.includes("conversation.menu"), "会话行没有渲染逐条菜单");
  for (const forbidden of ["SessionActionsMenu", "GroupSessionActionsMenu"]) {
    assert.ok(!sessions_panel.includes(forbidden), `面板自己构造了 ${forbidden}：职责应留给调用方`);
  }
  // `group/item` 是 RowMenuButton 显隐入口的钩子；少了它菜单永远不出现。
  assert.ok(sessions_panel.includes("group/item"), "会话行缺少 group/item：菜单入口不会随 hover 显隐");
});

test("两个主体的会话菜单各自完整，且都由 ChatSidebar 提供", () => {
  // Agent Session 有归档与「复制路径」，Group Session 没有——不能合并成一个菜单。
  assert.ok(chat_sidebar.includes("<SessionActionsMenu"), "Agent 会话缺少操作菜单");
  assert.ok(chat_sidebar.includes("<GroupSessionActionsMenu"), "Group 会话缺少操作菜单");
  for (const action of ["rename_session", "archive_session", "remove_session"]) {
    assert.ok(chat_sidebar.includes(action), `Agent 会话菜单缺少 ${action}`);
  }
  for (const action of ["rename_group_session", "remove_group_session"]) {
    assert.ok(chat_sidebar.includes(action), `Group 会话菜单缺少 ${action}`);
  }
  // 触发器的状态要跟着会话走，否则未读 / 失败的会话不会常显入口。
  assert.ok(/<RowMenuButton status=\{status\}/.test(chat_sidebar), "Agent 会话菜单入口没有带上行状态");
  assert.ok(/<GroupSessionActionsMenu[\s\S]{0,80}?status=\{status\}/.test(chat_sidebar), "Group 会话菜单入口没有带上行状态");
});

test("会话菜单仍可达：侧栏浮层与 Group 页头两条路径都在", () => {
  // 组会话重命名原先只在旧面板的行菜单里；面板移除后曾一度只剩 Group 页头入口。
  // 现在浮层的行菜单恢复了它，但页头入口仍要保留：浮层关着时不能变成死路。
  const group_view = read_without_comments(path.join(renderer_root, "features/group/GroupView.tsx"));
  const group_chat_page = read_without_comments(path.join(renderer_root, "features/chat/GroupChatPage.tsx"));
  assert.ok(group_view.includes("rename_session"), "Group 页头没有会话重命名入口");
  assert.ok(group_view.includes("conversation.rename"), "Group 页头没有引用重命名文案");
  assert.ok(group_chat_page.includes("rename_session={rename_session}"), "GroupChatPage 没有把重命名能力传下去");
});

/**
 * 性能契约：投影只为**展开的那几行**做，折叠的一行都不做。
 *
 * 能做的份数就等于展开数（一个浮动 + N 个嵌入）。那是用户真要看的东西，代价是必要的；
 * 要紧的是它仍然**不随主体总数**增长，也不是“每个主体都算一份备用”。
 *
 * 同时锁住行的 memo 不能被无谓破坏：两个回调必须引用恒定，折叠态必须拿到共享空数组
 * （就地 `?? []` 每帧新建数组，浅比较会认为 props 一直变）。
 */
test("投影只为展开的那几行做，折叠的一行都不做", () => {
  // 没有展开时直接返回共享空表，不做任何扫描。
  assert.ok(/if \(open_subject_keys\.length === 0\) return empty_conversations_by_subject;/.test(chat_sidebar), "没有展开时仍在投影：会白扫全量目录并重建菜单");
  // 投影只遍历展开中的那几个 key，而不是遍历所有主体。
  assert.ok(/for \(const key of open_subject_keys\)/.test(chat_sidebar), "投影没有只覆盖展开的那几行");
  assert.ok(chat_sidebar.includes("build_subject_conversations({"), "没有按需投影单个主体的会话");
  assert.ok(!/subjects\.map\([\s\S]{0,120}?build_subject_conversations/.test(chat_sidebar), "投影又铺在所有主体上了：折叠的主体也会被重建");
  // 行内不自己读会话表。
  assert.ok(!subject_list.includes("sessions_by_workspace"), "主体行自己在读会话表：投影应留在 ChatSidebar");
  assert.ok(!subject_list.includes("select_agent_sessions"), "主体行自己在投影会话：投影应留在 ChatSidebar");
});

/**
 * 「用完就收」是**浮动态专有**的，与“固定在不在”无关。
 *
 * 浮动盖着正文，选完会话就该让位；嵌入是用户按了固定开关才得到的工作台，用一次就自动
 * 收起来等于把固定撤销了——多开几个时更是没法用，每选一条会话都要重新固定一次。
 *
 * 实现上靠“不传 `close`”而不是“传一个空函数”：没有可执行的动作，比有一个什么都不做的
 * 动作更诚实。面板里写 `close?.()`。
 */
test("会话选中后的收尾只发生在浮动态", () => {
  assert.ok(/close=\{mode === "floating" \? close_after_use : undefined\}/.test(subject_list), "收起不在浮动态生效：嵌入的面板会在选完会话后自己合上");
  assert.ok(/close\?\(\)/.test(sessions_panel), "面板没有按“可选”处理 close");
  // 面板不得自己判断该不该收：那是行的策略，面板只执行。
  assert.ok(!/mode/.test(sessions_panel), "面板认识展开方式了：该不该收起应由行决定");
});

/**
 * 条数上限只给**嵌入**，而且超出的部分走菜单而不是滚动。
 *
 * 两层职责要分开：上限的**值**与缝界在 subjectCard（纯函数，可单测），
 * 面板只负责“拿到可见的几条 + 要不要留一个全部入口”。面板不得自己判上限值，
 * 否则改个数要跑到渲染层里找。
 */
test("条数上限只给嵌入态，且超过时给出「全部对话」入口", () => {
  // 只有嵌入态传 max_visible；浮动态传 undefined。
  assert.ok(/max_visible=\{mode === "docked" \? docked_visible_session_count : undefined\}/.test(subject_list), "条数上限没有只给嵌入态");
  assert.ok(!/max_visible=\{docked_visible_session_count\}/.test(subject_list), "浮动态也被封顶了：它点外部就收，不需要上限");
  // 缝界由纯函数决定，面板不自己 slice。
  const card = read_without_comments(path.join(sidebar_root, "subjectCard.ts"));
  assert.ok(/split_visible_sessions\(conversations, max_visible\)/.test(sessions_panel), "面板没有用纯函数切割可见会话");
  assert.ok(!/\.slice\(0, max_visible\)/.test(sessions_panel), "面板自己在算缝界：这类边界应该留在 subjectCard 里单独验证");
  assert.ok(/export function split_visible_sessions/.test(card), "缝界函数不在 subjectCard");
  assert.ok(/export const docked_visible_session_count = 4;/.test(card), "上限值没有集中定义");
  // 面板里不得拿字面量去判上限（`sideOffset={4}` 这种无关的 4 不必误伤）。
  assert.ok(!/[<>=!]==\s*4\b|\bcount\s*[<>]\s*4\b/.test(sessions_panel), "面板在拿字面量判条数上限");
});

/**
 * 「全部对话」菜单里放**全部**会话，而不只是被挡住的那几条，并且**向右飞出**。
 *
 * 放全部：用户点它的心态是「我要找的那条不在上面」；此时还要在“上面 4 条”与“菜单里 8 条”
 * 之间做除法，等于把上限这件事泄漏给了用户。
 *
 * 飞右边：它列的是名字，而侧栏最宽也只到 400（默认 280）。往下弹时菜单跟侧栏一样窄，
 * 每条标题都被截断，长的会话名一眼分不出谁是谁——而这正是用户点它的原因。
 * 这也跟侧栏既有的右侧飞出（Rail 的图标 tooltip）保持一致。
 *
 * 另外它必须是**菜单**而不是第二段滚动列表：菜单有键盘导航、选中态与高度兜底，
 * 而且不额外占高度。
 */
test("「全部对话」菜单向右飞出，列出全部会话，并且可键盘导航", () => {
  // 向右而不是向下：侧栏最宽也只到 400，往下弹时会话名会被截到认不出，
  // 而这条入口存在的理由就是“找那一条不在上面列表里的会话”。
  assert.ok(/<DropdownMenuContent side="right" align="start" sideOffset=\{8\} className=\{all_sessions_menu_class_name\}>/.test(sessions_panel), "「全部对话」菜单不是向右飞出的");
  // 宽度：比侧栏宽一档（320），但封在能完整读下标题的范围内（448）。
  // 两者都必须是类名而不是内联 style，否则设计令牌守卫扫不到它。
  assert.ok(/all_sessions_menu_class_name = "min-w-80 max-w-md"/.test(sessions_panel), "「全部对话」菜单没有自己的宽度档位，或宽度变了：默认的 min-w-52 比侧栏还窄");
  assert.ok(!/<DropdownMenuContent align="end" sideOffset=\{4\}>\{[\s\S]{0,200}?conversations\.map/.test(sessions_panel), "「全部对话」菜单又变回向下弹出了");
  // 会话行自己的三个动作仍然贴在行下面：它们只有三项，飞出去反而要跨过侧栏去追。
  // 菜单的数据源是全部会话，不是被挡住的那一部分。
  assert.ok(/<MoreSessionsRow conversations=\{conversations\}/.test(sessions_panel), "「全部对话」入口没有拿到全部会话");
  assert.ok(/conversations\.map\(\(conversation\) => \(\s*<DropdownMenuItem/.test(sessions_panel), "菜单项没有遍历全部会话");
  assert.ok(/translate\("sidebar.all_sessions", \{ count: conversations\.length \}\)/.test(sessions_panel), "入口文案没有说明它包含全部会话");
  // 当前会话与状态都要在这里认得出。
  assert.ok(/is_selected=\{conversation\.active\}/.test(sessions_panel), "菜单里看不出当前会话");
  assert.ok(/<ChatStatusIcon status=\{conversation\.status\} fallback=\{null\} \/>/.test(sessions_panel), "菜单项没有展示会话状态");
  // 菜单项里不能再放按钮：那会让菜单的键盘导航多出一层。
  assert.ok(!/<DropdownMenuItem[\s\S]{0,400}?conversation\.menu/.test(sessions_panel), "菜单项里又放了逐条操作菜单");
  // 收尾与普通会话行同源：嵌入态不传 close，因此选中后不关面板。
  assert.ok(/onClick=\{\(\) => \{ conversation\.select\(\); close\?\.\(\); \}\}/.test(sessions_panel), "菜单选中后的收尾与普通会话行不一致");
});

/**
 * 嵌入态**不得自带滚动容器**：否则鼠标停在固定面板上就滚不动整个侧栏。
 *
 * 这是个真的踩过的坑，而且现象很诱人：鼠标底下既然是滚动容器，滚轮就先归它；
 * 嵌入态内容装得下（最多 4 条会话 + 2 行，远不到 320px）所以一像素都不动，
 * 而 `overscroll-contain` 又禁止把滚动传给侧栏——整个手势被吃掉。
 *
 * 两边都上滚动容器看着“对称、安全”，其实是在一个本来就不需要滚的地方嵌套了一个滚，
 * 只造出一个不可滚的死区。因此这条断的是**分支**，不只是“两串类名还在”。
 */
test("嵌入态不自带滚动容器，滚动归侧栏", () => {
  // 只有没人封顶（浮动态）才自己滚。
  assert.ok(/const scrolls_itself = max_visible === undefined;/.test(sessions_panel), "没有区分“要不要自己滚”");
  assert.ok(/return scrolls_itself \? <div className=\{subject_panel_scroll_class_name\}>\{content\}<\/div> : content;/.test(sessions_panel), "嵌入态还包着滚动容器：鼠标停在固定面板上会滚不动侧栏");
  // 高度上限 + 滚动 + 不传递，三个必须同进同出：只剩 overflow 会让滚动传给侧栏。
  assert.ok(/subject_panel_scroll_class_name = "max-h-80 overflow-y-auto overscroll-contain"/.test(sessions_panel), "浮动态滚动层的三个类名不完整");
  // 内边距在内容上，两种形态一致（嵌动态没有外层，但那不能变成“内边距也取消”）。
  assert.ok(/<div className="p-1">/.test(sessions_panel), "列表内容丢了内边距");
});

/** 行的 memo 依赖 props 引用稳定；这两处最容易在重构里被写成每次新建。 */
test("行的 memo 不被引用变化破坏", () => {
  // 两个回调都引用恒定（空依赖 useCallback）。
  for (const name of ["advance_panel", "set_panel_mode"]) {
    assert.ok(new RegExp(`const ${name} = useCallback\\([\\s\\S]{0,400}?\\}, \\[\\]\\);`).test(chat_sidebar), `${name} 不是引用恒定的回调：行组件每次渲染都会失效`);
  }
  // 折叠态拿到共享空数组，而不是就地 `?? []`。
  assert.ok(/const conversations = mode \? props.open_conversations\.get\(subject\.key\) \?\? empty_conversations : empty_conversations;/.test(subject_list), "折叠态拿到新建数组：行组件的 memo 会全部失效");
  assert.ok(/export const empty_conversations: readonly SubjectConversation\[\] = \[\];/.test(sessions_panel), "没有集中定义共享空数组");
  assert.ok(/export const empty_conversations_by_subject: ReadonlyMap<string, readonly SubjectConversation\[\]> = new Map\(\);/.test(sessions_panel), "没有集中定义共享空投影表");
  // 展开方式要按主体各自读出，而不是跟着一个全局值透传。
  assert.ok(/const mode = panel_mode_of\(props\.open_panels, subject\.key\)/.test(subject_list), "没有按主体各自读出展开方式");
  // 行内部自建的回调也要引用恒定，否则会把 memo 传给下级时又破坏一次。
  assert.ok(/const handle_advance = useCallback\(\(\) => advance_panel\(subject_key\), \[advance_panel, subject_key\]\)/.test(subject_list), "行内回调每次新建，会破坏下级组件的 memo");
  assert.ok(/const handle_open_change = useCallback\(\(next: SubjectPanelMode \| null\) => set_panel_mode\(subject_key, next\), \[set_panel_mode, subject_key\]\)/.test(subject_list), "行内回调每次新建，会破坏下级组件的 memo");
});
