/** CLI 纯逻辑回归测试：slash 命令解析与 Plugin 配置协议校验。 */

import assert from "node:assert/strict"
import test from "node:test"
import { parseSlashInput } from "../bin/city/agent/tui/commands/parse.js"
import { resolveSlashCommandInput } from "../bin/city/agent/tui/commands/resolve.js"
import {
  validate_local_plugin_config,
  validate_local_plugin_config_schema,
} from "../../local/bin/product.js"

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

test("Plugin JSON Schema 校验成功配置并报告错误路径", () => {
  const schema = {
    type: "object",
    properties: {
      endpoint: { type: "string", format: "uri", minLength: 1, x_downcity: { widget: "url" } },
      mode: { type: "string", enum: ["safe", "fast"], default: "safe" },
    },
    required: ["endpoint", "mode"],
    additionalProperties: false,
  }
  assert.doesNotThrow(() => validate_local_plugin_config_schema(schema))
  assert.doesNotThrow(() => validate_local_plugin_config({ endpoint: "https://example.com", mode: "safe" }, schema))
  assert.throws(
    () => validate_local_plugin_config({ endpoint: "" }, schema),
    /config\/endpoint must NOT have fewer than 1 characters/iu,
  )
  assert.throws(
    () => validate_local_plugin_config({ endpoint: "https://example.com", mode: "invalid", extra: true }, schema),
    /config must NOT have additional properties/iu,
  )
  assert.throws(
    () => validate_local_plugin_config({ endpoint: "not-a-url", mode: "safe" }, schema),
    /config\/endpoint must match format "uri"/iu,
  )
  assert.throws(
    () => validate_local_plugin_config_schema({ type: "not-a-json-schema-type" }),
    /Invalid Plugin config schema/iu,
  )
})
