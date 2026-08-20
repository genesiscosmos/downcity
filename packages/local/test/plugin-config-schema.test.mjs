/** Plugin 配置 Schema 的分类、草稿与敏感字段边界测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  accepts_empty_local_plugin_config,
  create_local_plugin_config_draft,
  redact_local_plugin_write_only_values,
  restore_local_plugin_write_only_values,
} from "../bin/product.js";

const channel_schema = {
  type: "object",
  properties: {
    channels: {
      type: "array",
      items: {
        oneOf: [
          {
            type: "object",
            properties: {
              id: { type: "string" },
              type: { const: "telegram" },
              token: { type: "string", writeOnly: true },
            },
            required: ["id", "type", "token"],
          },
        ],
      },
    },
  },
  additionalProperties: false,
};

test("空配置接受程度决定 profile 是可选还是必需", () => {
  assert.equal(accepts_empty_local_plugin_config({
    type: "object",
    properties: { endpoint: { type: "string" } },
    additionalProperties: false,
  }), true);
  assert.equal(accepts_empty_local_plugin_config({
    type: "object",
    properties: { endpoint: { type: "string" } },
    required: ["endpoint"],
    additionalProperties: false,
  }), false);
});

test("新 profile 草稿只读取字段级 default 与 const", () => {
  assert.deepEqual(create_local_plugin_config_draft({
    type: "object",
    properties: {
      provider: { const: "playwright" },
      auto_start: { type: "boolean", default: false },
      endpoint: { type: "string" },
    },
  }), { provider: "playwright", auto_start: false });
});

test("writeOnly 不进入展示配置且按数组项目 ID 恢复", () => {
  const current = {
    channels: [
      { id: "first", type: "telegram", token: "secret-one" },
      { id: "second", type: "telegram", token: "secret-two" },
    ],
  };
  const visible = redact_local_plugin_write_only_values(current, channel_schema);
  assert.notEqual(visible.channels[0].token, "secret-one");
  assert.notEqual(visible.channels[1].token, "secret-two");

  const draft = { channels: [visible.channels[1]] };
  assert.deepEqual(
    restore_local_plugin_write_only_values(draft, current, channel_schema),
    { channels: [{ id: "second", type: "telegram", token: "secret-two" }] },
  );
  assert.deepEqual(
    restore_local_plugin_write_only_values({
      channels: [{ ...visible.channels[0], token: null }],
    }, current, channel_schema),
    { channels: [{ id: "first", type: "telegram" }] },
  );
});
