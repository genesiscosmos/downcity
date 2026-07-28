/**
 * Plugin tool 输入 schema。
 *
 * 关键点（中文）
 * - plugin_call 是 agent 内置的最低层 plugin action 入口。
 * - plugin_call.payload 是透传给具体 plugin action 的 JSON object。
 * - 这里不用 Zod 表达 payload 的开放对象语义，避免 AI SDK zodSchema
 *   转换后把 additionalProperties 收窄为 false。
 */

import { jsonSchema } from "ai";
import { z } from "zod";

export const plugin_call_input_schema = jsonSchema({
  type: "object",
  required: ["plugin", "action"],
  additionalProperties: false,
  properties: {
    plugin: {
      type: "string",
      description: "Registered plugin name to call, for example image.",
    },
    action: {
      type: "string",
      description: "Plugin action name to execute, for example image_create.",
    },
    payload: {
      type: "object",
      additionalProperties: true,
      default: {},
      description: "JSON payload passed to the plugin action.",
    },
  },
});

export const plugin_read_input_schema = z.object({
  plugin: z
    .string()
    .optional()
    .describe("Registered plugin name to inspect. Omit to list plugins."),
  action: z
    .string()
    .optional()
    .describe("Plugin action name to inspect. Requires plugin."),
});
