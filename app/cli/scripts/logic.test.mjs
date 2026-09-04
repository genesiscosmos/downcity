/** CLI 纯逻辑回归测试：slash 命令解析与命令回退。 */

import assert from "node:assert/strict"
import test from "node:test"
import { parseSlashInput } from "../bin/city/agent/tui/commands/parse.js"
import { resolveSlashCommandInput } from "../bin/city/agent/tui/commands/resolve.js"

test("slash 输入解析区分命令、参数、普通文本和 URL", () => {
  assert.equal(parseSlashInput("hello"), null)
  assert.equal(parseSlashInput("/"), null)
  assert.deepEqual(parseSlashInput("/compact   now "), { name: "compact", args: "now" })
  assert.equal(parseSlashInput("/https://example.com"), null)
})

test("内建 slash 命令未知时回退为普通消息", () => {
  assert.deepEqual(resolveSlashCommandInput({ input: "hello", is_streaming: false }), {
    kind: "not-command",
    input: "hello",
  })
  assert.deepEqual(resolveSlashCommandInput({ input: "/unknown value", is_streaming: false }), {
    kind: "message",
    input: "/unknown value",
  })
  assert.equal(resolveSlashCommandInput({ input: "/", is_streaming: false }).kind, "message")
})
