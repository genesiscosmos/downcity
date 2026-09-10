/** UI SDK 公开纯逻辑契约测试。 */

import assert from "node:assert/strict"
import test from "node:test"
import { buildWorkboardGameMapConfig, ChatPanel, ChatComposer, ChatHistory, ChatMessage, cn, create_chat_runtime, resolve_chat_composer_enter_action, session_message_to_chat_message } from "../dist/index.js"

test("Chat UI 公开导出保持可用", () => {
  assert.equal(typeof ChatPanel, "function")
  assert.equal(typeof ChatComposer, "function")
  assert.equal(typeof ChatHistory, "function")
  assert.equal(typeof ChatMessage, "function")
})

test("canonical Agent Action 与 Error Part 投影为 UI operation", () => {
  const message = session_message_to_chat_message({
    message_id: "agent-1",
    role: "agent",
    state: "done",
    parts: [
      { part_id: "action-1", sequence: 1, type: "action", action_type: "compact", state: "completed", title: "Compacted" },
      { part_id: "error-1", sequence: 2, type: "error", code: "turn_failed", message: "failed", recoverable: true },
    ],
  })
  assert.equal(message.role, "assistant")
  assert.equal(message.metadata.session_type, "agent")
  assert.equal(message.metadata.error, "failed")
  assert.deepEqual(message.parts.map((part) => part.type), ["operation", "operation"])
  assert.equal(message.parts[0].operation.status, "finished")
  assert.equal(message.parts[1].operation.status, "failed")
})

const enter_key = (overrides = {}) => ({ key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, isComposing: false, ...overrides })
const plain_paragraph = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] }

test("Chat Composer 使用统一 Enter 矩阵", () => {
  assert.equal(resolve_chat_composer_enter_action(enter_key(), plain_paragraph), "submit")
  assert.equal(resolve_chat_composer_enter_action(enter_key(), { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }, { type: "paragraph", content: [{ type: "text", text: "two" }] }] }), "native")
  assert.equal(resolve_chat_composer_enter_action(enter_key(), { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }, { type: "hardBreak" }] }] }), "native")
  assert.equal(resolve_chat_composer_enter_action(enter_key({ shiftKey: true }), plain_paragraph), "native")
  assert.equal(resolve_chat_composer_enter_action(enter_key({ metaKey: true }), undefined), "submit")
  assert.equal(resolve_chat_composer_enter_action(enter_key({ metaKey: true, altKey: true }), undefined), "queue-paused")
  assert.equal(resolve_chat_composer_enter_action(enter_key({ ctrlKey: true, altKey: true }), undefined), "queue-paused")
  assert.equal(resolve_chat_composer_enter_action(enter_key({ ctrlKey: true, shiftKey: true }), undefined), "submit-immediately")
  assert.equal(resolve_chat_composer_enter_action(enter_key({ isComposing: true }), plain_paragraph), "native")
})

test("steer 绕过 busy 和已有队列，常规发送保持排队", async () => {
  const submitted = []
  const runtime = create_chat_runtime({ submit_message: async (input, mode) => submitted.push({ input, mode }) })
  await runtime.submit({ text: "queued first", attachments: [] }, "queue")
  await runtime.submit({ text: "queued second", attachments: [] }, "send")
  await runtime.submit({ text: "steer now", attachments: [] }, "steer")
  assert.equal(runtime.get_snapshot().queued_inputs.length, 2)
  assert.deepEqual(submitted, [{ input: { text: "steer now", attachments: [] }, mode: "steer" }])
})

function create_agent(overrides = {}) {
  return {
    id: "agent-1",
    name: "Agent One",
    running: true,
    headline: "working",
    posture: "focused",
    momentum: "up",
    statusText: "active",
    collectedAt: new Date().toISOString(),
    currentCount: 1,
    recentCount: 0,
    signalCount: 0,
    snapshot: {
      name: "Agent One",
      running: true,
      statusText: "active",
      collectedAt: new Date().toISOString(),
      headline: "working",
      posture: "focused",
      momentum: "up",
      visibilityNote: "public",
      current: [{ id: "activity-1", kind: "focus", title: "Build", summary: "Build", status: "active", updatedAt: new Date().toISOString(), tags: [] }],
      recent: [],
      signals: [],
    },
    ...overrides,
  }
}

function create_board(agents) {
  return {
    summary: { totalAgents: agents.length, liveAgents: agents.length, activeAgents: agents.length, quietAgents: 0 },
    agents,
    collectedAt: new Date().toISOString(),
  }
}

test("cn 合并条件类名并覆盖 Tailwind 冲突类", () => {
  assert.equal(cn("px-2", false && "hidden", "px-4"), "px-4")
  assert.match(cn("text-sm", { "font-bold": true }), /text-sm/)
  assert.match(cn("text-sm", { "font-bold": true }), /font-bold/)
})

test("Workboard 地图配置保持 zone、actor、patrol 和选中状态一致", () => {
  const agents = [
    create_agent(),
    create_agent({ id: "agent-2", name: "Agent Two", currentCount: 0, snapshot: { ...create_agent().snapshot, current: [], recent: [], signals: [] } }),
  ]
  const config = buildWorkboardGameMapConfig({
    board: create_board(agents),
    activeZoneId: "engaged",
    selectedAgentId: "agent-1",
  })
  assert.equal(config.actors.length, 2)
  assert.equal(config.actors.find((actor) => actor.id === "agent-1").active, true)
  assert.equal(config.zones.find((zone) => zone.id === "engaged").count, 1)
  assert.equal(config.zones.find((zone) => zone.id === "quiet").count, 1)
  assert.equal(config.patrols.length, 1)
  assert.equal(config.patrols[0].active, true)
  assert.equal(config.pointsOfInterest.at(-1).id, "engaged-hub")
  assert.equal(config.areaLabels.length, 3)
})
