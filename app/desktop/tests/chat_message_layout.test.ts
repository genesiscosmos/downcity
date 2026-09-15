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
  for (const shared of ["agent_message_root_class_name", "agent_identity_row_class_name", "agent_identity_avatar_class_name", "agent_message_footer_class_name"]) {
    assert.ok(frames.AgentMessageFrame.includes(shared), `AgentMessageFrame 没有使用共享的 ${shared}`);
  }
  // 身份行高度定义了正文起点，头像尺寸必须一致，否则两个形态会差几像素。
  assert.ok(read_class_name(layout_source, "agent_identity_row_class_name").includes("py-0.5"), "身份行没有纵向内边距，头像达不到 24px 触控高度");
  assert.equal(read_class_name(layout_source, "agent_identity_avatar_class_name"), "size-5 rounded");
});
