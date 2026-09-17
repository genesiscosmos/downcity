/**
 * Chat 消息行布局的守卫（Agent 与用户两侧，Session 与 Group 两个表面）。
 *
 * ## 为什么需要这个文件
 *
 * 同一套消息结构出现在两个表面上，因此「各写一遍 DOM」是最容易发生的退化：
 * 历史上 Agent 正文在 Session 侧是「头像列 28px + 间距 8px」、在 Group 侧是
 * 「头像列 32px + px-1」；用户消息的元信息行则是 `h-6 gap-1` 与 `gap-1.5 px-1` 两种写法。
 * 视觉上只是几个像素，但同一件事有两种长相，改一处就会漏另一处。
 *
 * 现在两侧都走 `AgentMessageFrame` / `UserMessageFrame`，几何集中在 `message_layout`。
 * 本文件锁住三件事：
 *
 * 1. 消息是**上下两段**（身份在上、正文在下），不再是「头像列 + 正文列」的并排；
 * 2. 头像不 sticky，且不靠左内边距把正文推离消息列左缘；
 * 3. 两个表面**不得自己写消息几何**——必须使用共享骨架。
 *
 * 断言源码而不是渲染结果，是因为本仓库的测试不引入 DOM 环境（见 design_token_drift）。
 * 这些类名本身就是布局的唯一事实源，集中在 message_layout 里管理。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const renderer_root = path.join(import.meta.dirname, "../src/renderer");
const messages_root = path.join(renderer_root, "features/chat/components/messages");
const layout_path = path.join(messages_root, "message_layout.ts");

/** 读取渲染层文件，去掉注释——注释里会引用被禁止的写法来解释为什么禁止。 */
function read_without_comments(file_path: string): string {
  return fs.readFileSync(file_path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

/** 取出一条导出的类名常量值。 */
function read_class_name(source: string, name: string): string {
  const match = new RegExp(`${name} = "([^"]*)"`).exec(source);
  assert.ok(match, `message_layout 里找不到 ${name}`);
  return match![1]!;
}

const layout_source = read_without_comments(layout_path);
const frames = {
  AgentMessageFrame: read_without_comments(path.join(messages_root, "AgentMessageFrame.tsx")),
  UserMessageFrame: read_without_comments(path.join(messages_root, "UserMessageFrame.tsx")),
} as const;
const consumers = {
  "AgentMessage": read_without_comments(path.join(messages_root, "AgentMessage.tsx")),
  "AgentRuntimeIndicator": read_without_comments(path.join(messages_root, "AgentRuntimeIndicator.tsx")),
  "UserMessage": read_without_comments(path.join(messages_root, "UserMessage.tsx")),
  "GroupView": read_without_comments(path.join(renderer_root, "features/group/GroupView.tsx")),
} as const;

/**
 * Agent 正文渲染器与用户消息内容单独读，不进 `consumers`。
 *
 * Agent 正文渲染器同时渲染失败提示条（图标 + 文字，同样是 `items-start gap-2`），
 * 放进「不得是并排消息行」那组启发式断言里会产生假阳性。
 */
const agent_message_content = read_without_comments(path.join(messages_root, "AgentMessageContent.tsx"));
const user_message_content = read_without_comments(path.join(renderer_root, "features/chat/components/UserMessageContent.tsx"));
const composer_styles = fs.readFileSync(path.join(renderer_root, "styles/base.css"), "utf8");
const theme_tokens = fs.readFileSync(path.join(renderer_root, "styles/tokens.css"), "utf8");
const markdown_styles = fs.readFileSync(path.join(renderer_root, "styles/markdown.css"), "utf8");

/** Tailwind 的 `--spacing`：1 个单位 = 0.25rem，即 `gap-3` → 0.75rem。 */
const TAILWIND_SPACING_REM = 0.25;

/**
 * 可感知的最小差值：0.125rem。
 *
 * 三个量级都用 rem 比较，所以本文件不需要知道根字号是多少——这也正是为什么
 * 字号与行高必须全部用 rem：px 只在 100% 缩放下才对得上，而界面缩放会改写根字号。
 */
const MIN_PERCEPTIBLE_GAP_REM = 0.125;

/** 消息正文文字排版的消费处，按角色分开。 */
const text_consumers = {
  AgentMessageContent: agent_message_content,
  UserMessageContent: user_message_content,
  GroupView: consumers.GroupView,
} as const;

/**
 * 读出消息正文用的语义字号档；段落间距的换算与归组断言都用它。
 *
 * 正文不另开字号档位，直接用**默认档** `--text-base`（0.9375rem），
 * 行高单独取 `--leading-reading`（1.8，无单位倍数）——`base` 的配对行高是
 * 1.25rem，是 UI 文本的密度，对长段落太挤。所以这里读两个令牌，而不是一个配对。
 */
function read_body_type_token(): { size_rem: number; line_height: number } {
  const size = /--text-base:\s*([\d.]+)rem/.exec(theme_tokens);
  const line_height = /--leading-reading:\s*([\d.]+)/.exec(theme_tokens);
  assert.ok(size && line_height, "tokens.css 里缺少 --text-base / --leading-reading");
  return { size_rem: Number(size[1]), line_height: Number(line_height[1]) };
}

/** 读出 `markdown.css` 里段落之间的外边距（em 倍数，相邻段落折售后就是这个值）。 */
function read_paragraph_margin_em(): number {
  const rule = /\.markdown :where\(p\)\s*\{([\s\S]*?)\}/.exec(markdown_styles);
  assert.ok(rule, "markdown.css 里找不到 .markdown :where(p) 规则");
  const margin = /margin:\s*([\d.]+)em/.exec(rule[1]);
  assert.ok(margin, "段落没有声明 em 外边距；段落间距必须随字号缩放");
  return Number(margin[1]);
}

test("Agent 消息是上下两段，不再有头像列", () => {
  const root = read_class_name(layout_source, "agent_message_root_class_name");
  assert.ok(root.includes("flex-col"), `Agent 消息根容器不是列：${root}`);
  // 「并排」的旧写法：一行 + 顶部对齐 + 头像与正文之间的 gap。
  assert.ok(!root.includes("flex-row") && !root.includes("items-start") && !/\bgap-2\b/.test(root), `Agent 消息根容器还在并排布局：${root}`);
});

test("Agent 正文不被左内边距推离消息列左缘", () => {
  const body = read_class_name(layout_source, "agent_message_body_class_name");
  assert.ok(body.includes("w-full"), `正文容器不占满消息列：${body}`);
  assert.ok(!/\b(pl|ml)-/.test(body), `正文容器带左内边距，正文与身份行会分成两条竖线：${body}`);
  assert.ok(frames.AgentMessageFrame.includes("agent_message_body_class_name"), "AgentMessageFrame 没有使用共享的正文容器类名");
});

/**
 * 正文块与活动块之间的间距必须夹在「段落间距」与「消息间距」之间。
 *
 * 用 rem 比较而不是直接比数字，因为三个量级的单位不同：段落是 em（随正文字号），
 * 块间距是 rem（随根字号），消息间距是根容器的 py-2。直接比数字会得出错误结论。
 */
test("消息正文的块间距夹在段落间距与消息间距之间", () => {
  const body = read_class_name(layout_source, "agent_message_body_class_name");
  const gap = /\bgap-(\d+(?:\.\d+)?)\b/.exec(body);
  assert.ok(gap, `正文容器没有声明块间距：${body}`);

  const paragraph_rem = read_paragraph_margin_em() * read_body_type_token().size_rem;
  const block_rem = Number(gap[1]) * TAILWIND_SPACING_REM;
  // 根容器 py-2：上下两段合计 1rem。
  const message_rem = 1;

  assert.ok(block_rem > paragraph_rem, `块间距（${block_rem}rem）不大于段落间距（${paragraph_rem}rem）：「另起一段」与「后面跟了工具活动」看起来一样宽`);
  assert.ok(block_rem < message_rem, `块间距（${block_rem}rem）不小于消息间距（${message_rem}rem）：同一条消息会被读成两条`);
  /*
   * 光「大于」不够：`gap-2`（0.5rem）比段落间距只大一点点，虽然满足上面两个不等式，
   * 视觉上两个层级已经抹平。留至少 0.125rem 的可感知差值，把“小一点”和“小到看不出来”分开。
   *
   * 这条断言同时锁住了**字号的上限**：段落间距是 0.5em（随字号走），
   * 因此 `0.5 × 字号 ≤ 块间距 − 0.125rem`，在块间距 0.75rem 下等价于字号 ≤ 1.25rem。
   * 所以调大字号时它会失败——这是有意的：加字号就必须同时加块间距，
   * 否则正文与活动会粘在一起。
   */
  assert.ok(block_rem - paragraph_rem >= MIN_PERCEPTIBLE_GAP_REM, `块间距与段落间距只差 ${block_rem - paragraph_rem}rem，两个层级会看起来一样；
    要再收紧块间距必须先降段落间距，要调大消息字号必须先抬块间距（字号 ${read_body_type_token().size_rem}rem × 段落 0.5em 已占掉 ${paragraph_rem}rem）`);
});

/**
 * 消息字号必须只有一个来源，且四个消费处都用它。
 *
 * 「两侧保持一致」是明确的产品要求：对话是两侧对照着读的，字号不同会让其中一侧无故显得
 * 偏大或偏小。必须同值的还有 Composer↔用户气泡（同一段文字发送前后的两种状态）。
 *
 * 注意：本文件只能验证**源码上的引用关系**。「这个类在浏览器里是否真的生效」由
 * `tailwind_merge_classes.test.ts` 验证——那里跑真正的 `cn`。
 */
test("消息字号只有一个来源，两侧共用；行高按角色各一档", () => {
  const agent_text = read_class_name(layout_source, "chat_message_text_class_name");
  const user_text = read_class_name(layout_source, "user_message_text_class_name");

  /*
   * **字号必须两侧同值**：曾经各设一档（13px / 15.5px），反馈是
   * 「agent message 和 user message 的字体应该保持一致」。
   * 这条不能因为行高拆开而一起松掉。
   */
  for (const [name, value] of [["Agent 正文", agent_text], ["用户气泡", user_text]] as const) {
    assert.ok(/\btext-base\b/.test(value), `${name} 没有使用默认档 base：${value}`);
    assert.ok(!/text-\[/.test(value), `${name} 自己写了任意字号：${value}`);
  }

  /*
   * **行高按角色分开**，这是有意的：
   * - Agent 正文是长文，1.8 是 15px 下被验证过的阅读节奏（1.7 被否过）；
   * - 用户气泡多是短句，在紧凑气泡里 1.8 显得松，取 1.6。
   * 两者各自的依据写在 `tokens.css`。若有人把它们改成同一个值，这条会失败并要求确认。
   */
  assert.ok(/\bleading-reading\b/.test(agent_text), `Agent 正文不是阅读行高：${agent_text}`);
  assert.ok(/\bleading-chat\b/.test(user_text), `用户气泡不是气泡行高：${user_text}`);

  const { size_rem } = read_body_type_token();
  // 必须等于默认档 base（0.9375rem = 15px）。
  assert.equal(size_rem, 0.9375, `消息字号不是默认档 base（0.9375rem）：${size_rem}rem`);
  /*
   * 0.5em 段落间距在正文超过 xl（1.25rem）时会顶到块间距。
   * 上限随块间距变化：`0.5 × 字号 ≤ 块间距 − 0.125`。
   */
  assert.ok(size_rem <= 1.25, `消息字号超过 xl（1.25rem），段落间距会顶到块间距：${size_rem}rem`);

  // 四个消费处：Session 的两种消息、Group 的两种发言，各自用本角色的常量。
  for (const [name, source] of Object.entries({ AgentMessageContent: text_consumers.AgentMessageContent, "GroupView(agent)": text_consumers.GroupView })) {
    assert.ok(source.includes("chat_message_text_class_name"), `${name} 没有使用 Agent 侧的共享排版`);
  }
  assert.ok(text_consumers.UserMessageContent.includes("user_message_text_class_name"), "UserMessageContent 没有使用用户侧的共享排版");
  assert.ok(text_consumers.GroupView.includes("user_message_text_class_name"), "GroupView 的用户发言没有使用用户侧的共享排版");

  // 旧的内联写法不得回归。
  for (const [name, source] of Object.entries(text_consumers)) {
    assert.ok(!/text-\[0\.8125rem\]|leading-\[1\.(?:34|54)\]/.test(source), `${name} 仍内联旧的 13px / 紧凑行高写法`);
  }
});

/**
 * Composer 与用户气泡必须同源。
 *
 * 两边分居 TSX 与 CSS，无类型可达。字号由 `--text-base` 提供，两处都只引用它，
 * 因此数值一定一致；但「引用同一个令牌」这件事本身仍会漂移：有人可能把某一边改回写死数值。
 * 那种情况下 Composer 与气泡会在回车前后用两种字号，只在发送瞬间可见，很容易漏过 review。
 * 所以这里锁两件事：两边都引用令牌，且没人再写死数值。
 */
test("Composer 与用户气泡的字号行高同源", () => {
  const text = read_class_name(layout_source, "user_message_text_class_name");
  assert.ok(/\btext-base\b/.test(text) && /\bleading-chat\b/.test(text), `用户气泡没有引用语义字号档：${text}`);

  const editor = /\.chat-input-editor,\s*\n?\.chat-input-editor\.ProseMirror\s*\{([\s\S]*?)\}/.exec(composer_styles);
  assert.ok(editor, "base.css 里找不到 .chat-input-editor 规则块");
  assert.ok(/font-size:\s*var\(--text-base\)/.test(editor[1]), ".chat-input-editor 没有引用 --text-base：发送前后字号会跳变");
  assert.ok(
    /line-height:\s*var\(--leading-chat\)/.test(editor[1]),
    ".chat-input-editor 没有引用 --leading-chat：发送前后段落高度会跳变。"
      + "注意它不该引用 --leading-reading：那是 Agent 长文的 1.8，在输入框里太松",
  );
  // 反向：不允许再用字面量写死字号或行高。
  assert.ok(!/font-size:\s*[\d.]+rem/.test(editor[1]), ".chat-input-editor 又用字面量写死了字号");
  assert.ok(!/line-height:\s*[\d.]+\s*!important/.test(editor[1]), ".chat-input-editor 又用字面量写死了行高");
});

test("用户消息是右侧气泡 + 下方元信息行", () => {
  const root = read_class_name(layout_source, "user_message_root_class_name");
  assert.ok(root.includes("justify-end"), `用户消息没有靠右：${root}`);
  const meta = read_class_name(layout_source, "user_message_meta_class_name");
  // 固定高度：悬停出现操作栏时不能把下方消息推走。
  assert.ok(meta.includes("h-6"), `元信息行没有固定高度：${meta}`);
  assert.ok(frames.UserMessageFrame.includes("user_message_meta_class_name"), "UserMessageFrame 没有使用共享的元信息行类名");
});

test("头像不再 sticky，也不再占一整列", () => {
  // 并排消息行的旧签名是「一行 + 顶部对齐 + 头像与正文间距」。
  // 不能只查 `items-start`：多处无关 UI（如弹窗里的多行选项按钮）合法地使用它。
  for (const [name, source] of Object.entries({ ...frames, ...consumers })) {
    assert.ok(!source.includes("sticky"), `${name} 仍有 sticky：长消息滚动时头像会脱离自己的身份行`);
    assert.ok(!source.includes("items-start gap-2"), `${name} 仍是顶部对齐的并排消息行`);
    // 旧写法的残留：给 Footer 加左内边距让「思考中」对齐正文列。
    assert.ok(!/\bpl-1\b/.test(source), `${name} 用左内边距对位：状态行会与相邻消息的正文错开`);
  }
});

/**
 * 两个表面不得自己写消息几何。
 *
 * 这是本文件最重要的一条：只要 Group 侧再出现 `size-8` 头像或 `rounded-2xl rounded-tl-none`
 * 气泡，两个表面就已经分叉了，而分叉在视觉上只是几个像素，review 时很容易放过。
 */
test("两个表面都用共享骨架，不自己写消息几何", () => {
  // Session 侧的四种 Agent 行都必须走 Frame。
  assert.ok(consumers.AgentMessage.includes("<AgentMessageFrame"), "AgentMessage 没有使用 AgentMessageFrame");
  assert.ok(consumers.AgentRuntimeIndicator.includes("<AgentMessageFrame"), "AgentRuntimeIndicator 的独立形态没有使用 AgentMessageFrame");
  assert.ok(consumers.UserMessage.includes("<UserMessageFrame"), "UserMessage 没有使用 UserMessageFrame");
  // Group 侧的四种行型同理。
  for (const frame of ["<AgentMessageFrame", "<UserMessageFrame"]) {
    assert.ok(consumers.GroupView.includes(frame), `GroupView 没有使用 ${frame}：Group 侧又自己写了消息几何`);
  }
  // Group 侧不得残留任何内联消息几何。
  for (const forbidden of ["items-start", "size-8 rounded-md", "rounded-tl-none", "user-message-stack", "max-w-[min(80%,42rem)]"]) {
    assert.ok(!consumers.GroupView.includes(forbidden), `GroupView 仍内联了消息几何「${forbidden}」：几何只能来自共享骨架`);
  }
});

test("消息几何只有一个来源", () => {
  // 旧模块已删除；类名常量只允许在 message_layout 里定义。
  assert.ok(!fs.existsSync(path.join(messages_root, "agent_message_layout.ts")), "旧的 agent_message_layout.ts 仍在：几何会有两个来源");
  for (const [name, source] of Object.entries(consumers)) {
    assert.ok(!/class_name = "/.test(source), `${name} 自己定义了消息布局类名常量，应放进 message_layout`);
  }
  // 「思考中」的状态行也必须只有一个实现（Session 与 Group 共用）。
  assert.ok(consumers.AgentRuntimeIndicator.includes("export function AgentThinkingStatus"), "AgentThinkingStatus 没有被导出：Group 无法复用状态行");
  assert.ok(consumers.GroupView.includes("AgentThinkingStatus"), "Group 没有复用共享的状态行组件");
});

test("两个形态共用同一份身份行与 Footer 几何", () => {
  for (const shared of ["agent_message_root_class_name", "agent_identity_row_class_name", "agent_identity_avatar_class_name", "agent_identity_name_class_name", "agent_message_footer_class_name"]) {
    assert.ok(frames.AgentMessageFrame.includes(shared), `AgentMessageFrame 没有使用共享的 ${shared}`);
  }
  /*
   * 身份行高度定义正文起点，而它由头像尺寸决定，所以头像不能单独在某一侧改动。
   * `size-6` = 1.5rem = 24px，刚好是 WCAG 2.2 的目标尺寸下限，
   * 因此 `py-0.5` 不再是触控垫高而是行间呼吸；两者一起决定身份行的 28px 高度。
   */
  assert.ok(read_class_name(layout_source, "agent_identity_row_class_name").includes("py-0.5"), "身份行没有纵向内边距，头像会贴住正文");
  assert.equal(read_class_name(layout_source, "agent_identity_avatar_class_name"), "size-6 rounded", "身份行头像不再是 24px：身份行高度会随之变化，消息与「思考中」状态行的正文起点必须同步核对");
  assert.equal(
    read_class_name(layout_source, "agent_identity_name_class_name"),
    "min-w-0 truncate text-sm font-medium text-foreground",
    "身份行名称的尺寸/字重被改动；它比元信息大一档（sm，不是 xs 也不是 base），改档位需同步确认与时间戳的主次关系",
  );
});
