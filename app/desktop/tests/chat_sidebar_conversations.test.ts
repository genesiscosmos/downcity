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

test("主体行的两个入口职责固定：头像管主体，右侧展开列表", () => {
  // 头像触发的是主体级操作菜单（新建对话 / 配置 / 删除）。
  assert.ok(subject_list.includes("<DropdownMenuTrigger asChild><Button size=\"icon\""), "头像不再是主体操作菜单的触发器");
  assert.ok(subject_list.includes("on_open_change"), "主体行缺少会话列表的展开开关");
  assert.ok(!subject_list.includes("<SubjectConversationsMenu"), "主体行又用回了外挂的下拉菜单");
  // 中间的选择区必须仍然存在且可点，否则点头像不再打开对话之后就没有打开主体的地方了。
  assert.ok(subject_list.includes("onClick={on_select}"), "主体行缺少打开主体的选择区");
  assert.ok(subject_list.includes('aria-current={active ? "page" : undefined}'), "选择区没有表达当前项");
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
  assert.ok(/<div ref=\{card_ref\} className=\{subject_item_expanded_class_name\}>/.test(subject_list), "找不到唯一的卡片元素（或它没有 ref，点外部判定就没有边界）");
  // 行内容在两个状态之间必须原样复用：各写一份迟早会走形。
  assert.ok(/const row_content = <>/.test(subject_list) && /\{row_content\}/.test(subject_list), "行内容没有在两个状态间复用");
  const card = read_without_comments(path.join(sidebar_root, "subjectCard.ts"));
  assert.ok(/subject_item_expanded_class_name = `absolute[^`]*flex-col[^`]*rounded-lg border border-border bg-background`/.test(card), "卡片不是单个纵向容器");
  assert.ok(/subject_card_panel_class_name = "shrink-0"/.test(card), "卡片下半不是卡片内的普通流子节点");
  // 卡片两半在同一个流里，因此不存在“接缝对齐”这件事。
  assert.ok(!/subject_card_(top|bottom)_style/.test(subject_list + card), "又出现了拆分接缝的样式辅助：说明卡片又被拆成两个盒子了");
});

/**
 * 卡片不占后续行的空间，但**跟它们一起滚**。
 *
 * 槽位撑住行在列表里的位置（后面的主体不会因展开而移动），卡片绝对定位于它，
 * 向下浮在后续行之上；两者同在一个滚动容器里，所以滚动时永远一起走。
 */
test("卡片浮在上面但跟列表一起滚", () => {
  const card = read_without_comments(path.join(sidebar_root, "subjectCard.ts"));
  assert.ok(/subject_slot_class_name = `relative \$\{subject_row_height_class_name\}`/.test(card), "槽位没有占住行高，展开时后面的主体会被挤走");
  assert.ok(/absolute inset-x-0 top-0/.test(card), "卡片不是相对槽位绝对定位");
  assert.ok(/subject_item_expanded_class_name = `absolute inset-x-0 top-0 z-20/.test(card), "展开的卡片没有抬到后续行之上");
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
 * 面板默认**点外部收起**，由固定开关关掉。
 *
 * 面板会盖住它下面的行，所以默认必须是「点开外部就收起」，否则用户想点被盖住的行时
 * 只能依靠那个折角去关它。需要边看边操作时（对照正文）才把固定打开。
 *
 * 这条同时锁住固定开关的存在与语义：它必须是个切换按钮（`aria-pressed`），
 * 且监听只在「未固定」时挂上。
 */
test("默认点外部收起，固定开关可关掉它", () => {
  // 默认行为：未固定时挂 pointerdown，点卡片外就收起。
  assert.ok(/if \(!expanded \|\| pinned\) return;/.test(subject_list), "点外部收起没有按 pinned 把关：固定开关会失效");
  assert.ok(/addEventListener\("pointerdown"/.test(subject_list), "缺少点外部收起（面板会盖住下面的行，只能靠折角关掉）");
  assert.ok(/card_ref\.current\?\.contains/.test(subject_list), "点外部判定没有排除卡片自身");
  assert.ok(/removeEventListener\("pointerdown"/.test(subject_list), "监听没有清理，会泄漏");
  // 固定不是默认：状态在 ChatSidebar，展开时重置。
  assert.ok(/const \[pinned, set_pinned\] = useState\(false\)/.test(chat_sidebar), "固定的默认值不是 false");
  assert.ok(/if \(open\) set_pinned\(false\)/.test(chat_sidebar), "展开新面板时没有重置固定：" + "固定不是要记住的模式，否则用户下次会以为界面坏了");
  // Esc 是明确动作，不受固定影响。
  assert.ok(/event\.key !== "Escape"/.test(subject_list), "缺少 Esc 关闭");
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
test("折叠与展开共用同一个边框盒：边框、行高、内边距各只有一个定义", () => {
  const card = read_without_comments(path.join(sidebar_root, "subjectCard.ts"));
  // 折叠态：行自己就是边框盒，边框透明但占位。
  assert.ok(/subject_item_collapsed_class_name = `\$\{row_layout_class_name\} \$\{subject_row_height_class_name\} rounded-lg border border-transparent/.test(card), "折叠态没有「边框 + 行高」这套边框盒，展开时内容会位移");
  // 展开态：同一个边框盒变成卡片。
  assert.ok(/subject_item_expanded_class_name = `absolute[^`]*\$\{subject_row_height_class_name\} flex-col[^`]*rounded-lg border border-border/.test(card), "展开态的边框盒与折叠态不同源");
  // 行内边距只有一份，两种状态共用。
  assert.ok(/const row_layout_class_name = "group\/item flex items-center gap-2\.5 px-1\.5 py-1"/.test(card), "行内边距没有集中定义");
  // 展开态的行内容在边框盒**内部**，高度要减掉上下边框，否则内容被推低 2px。
  assert.ok(/subject_row_class_name = `\$\{row_layout_class_name\} \$\{subject_row_content_height_class_name\}/.test(card), "展开态的行没有使用折算后的高度");
  assert.ok(/subject_row_content_height_class_name = "min-h-\[calc\(3rem-2px\)\]"/.test(card), "换算后的行高没有集中定义");
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
test("折叠态不渲染卡片与列表，但保留边框盒", () => {
  assert.ok(/if \(!expanded\) return <div className=\{cn\(subject_item_collapsed_class_name/.test(subject_list), "折叠态没有提前返回：会多渲染槽位、卡片与列表");
  assert.ok(/\{row_content\}<\/div>\s*<div id=\{panel_id\}/.test(subject_list), "展开态没有把行内容与列表放进同一个卡片里");
  assert.ok(/<div className=\{subject_slot_class_name\}>/.test(subject_list), "展开态没有搭出槽位");
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
  assert.ok(/aria-controls=\{panel_id\}/.test(subject_list), "触发器没有指向它控制的列表");
  assert.ok(/id=\{panel_id\}/.test(subject_list), "被控制的列表没有可引用的 id");
  // useId 而不是写死：同一列表里有多行，写死的 id 会重复。
  assert.ok(/useId\(\)/.test(subject_list), "面板 id 是写死的，多行会重复");
  // 不再是 dialog / 菜单，因此不应该残留 aria-haspopup。
  assert.ok(!/aria-haspopup/.test(subject_list), "展开按钮不该声明为弹出层：它是一段展开的内容");
});

/**
 * 开合状态归 ChatSidebar，一次只开一个。
 *
 * 状态放在行内会让两行各自记一个布尔值、两张卡同时开着。
 * 处理函数还必须对回调顺序不敏感：关闭事件可能来自「按下另一个触发器时被判定为点外部」，
 * 彼时用户其实正在开新的那个，一律置空会把刚打开的又关掉。
 *
 * 放在 ChatSidebar 而不是列表层，是因为**投影也要用它**（只为展开的主体建会话列表），
 * 两件事共用同一个信号。
 */
test("开合由 ChatSidebar 拥有，一次只开一个", () => {
  assert.ok(chat_sidebar.includes("open_subject_key"), "开合状态不在 ChatSidebar");
  assert.ok(chat_sidebar.includes("opened_subject_key"), "没有校验打开的主体是否还在列表里");
  assert.ok(/current === key \? null : current/.test(chat_sidebar), "关闭时无条件置空：会误关刚打开的卡片");
  // 受控：行只上报意图，不自己持有状态。
  assert.ok(/expanded: boolean/.test(subject_list) && /expanded=\{expanded\}/.test(subject_list), "行没有从上层接收开合状态");
  assert.ok(/onClick=\{\(\) => on_open_change\(!expanded\)\}/.test(subject_list), "展开按钮没有把意图上报给上层");
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
  const scroll_tag = /<div className="(max-h-80 overflow-y-auto overscroll-contain)">/.exec(sessions_panel);
  assert.ok(scroll_tag, `找不到滚动容器，或它带上了额外样式：${sessions_panel.slice(0, 200)}`);
  assert.ok(!/\b(p[xltrby]?|pl|pr|pt|pb)-/.test(scroll_tag[1]!), `滚动容器带上了内边距，滚动条不会贴边：${scroll_tag[1]}`);

  // 列表内边距在滚动容器**内部**的包装层上。
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
  assert.ok(/subject_item_expanded_class_name = `absolute[^`]*bg-background`/.test(card), "展开的卡片没有铺底色");

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
  assert.ok(/conversation\.select\(\); close\(\)/.test(sessions_panel), "会话行不再一键切换");
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
 * 性能契约：投影只为**展开的那一个**主体做，折叠时一次都不做。
 *
 * 这是本模块最贵的一段：它要扫全量 Session 目录、逐条算通知状态、并逐条建出操作菜单。
 * 早先它对着**所有**主体跑，而依赖里又含 `selection`——点一次会话就会把每个主体的列表与
 * 菜单全量重建，而同时只有一个主体看得见。
 *
 * 同时锁住行的 memo 不能被无谓破坏：`set_open` 必须引用恒定，折叠态必须拿到共享空数组
 * （就地 `?? []` 每帧新建数组，浅比较会认为 props 一直变）。
 */
test("投影只为展开的主体做，一行都不多做", () => {
  // 折叠时直接返回共享空数组，不做任何扫描。
  assert.ok(/if \(!opened_subject_key\) return empty_conversations;/.test(chat_sidebar), "折叠时仍在投影会话列表：会白扫全量目录并重建菜单");
  // 投影按单个主体调用（而不是遍历所有主体塞进一张表）。
  assert.ok(chat_sidebar.includes("build_subject_conversations({"), "没有按需投影单个主体的会话");
  assert.ok(!chat_sidebar.includes("conversations_by_subject"), "又出现了全量投影表：折叠的主体也会被重建");
  // 行内不自己读会话表。
  assert.ok(!subject_list.includes("sessions_by_workspace"), "主体行自己在读会话表：投影应留在 ChatSidebar");
  assert.ok(!subject_list.includes("select_agent_sessions"), "主体行自己在投影会话：投影应留在 ChatSidebar");
});

/** 行的 memo 依赖 props 引用稳定；这两处最容易在重构里被写成每次新建。 */
test("行的 memo 不被引用变化破坏", () => {
  // set_open 引用恒定（空依赖 useCallback）。
  assert.ok(/const set_open = useCallback\(\(key: string, open: boolean\) => \{[\s\S]{0,200}?\}, \[\]\)/.test(chat_sidebar), "set_open 不是引用恒定的回调：行组件每次渲染都会失效");
  // 折叠态拿到共享空数组，而不是就地 `?? []`。
  assert.ok(/const conversations = expanded \? props.open_conversations : empty_conversations;/.test(subject_list), "折叠态拿到新建数组：行组件的 memo 会全部失效");
  assert.ok(/export const empty_conversations: readonly SubjectConversation\[\] = \[\];/.test(sessions_panel), "没有集中定义共享空数组");
  // 行内部自建的回调也要引用恒定，否则会把 memo 传给下级时又破坏一次。
  assert.ok(/const handle_open_change = useCallback\(\(open: boolean\) => set_open\(subject_key, open\), \[set_open, subject_key\]\)/.test(subject_list), "行内回调每次新建，会破坏下级组件的 memo");
});
