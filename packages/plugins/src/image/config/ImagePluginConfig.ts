/**
 * Image Plugin 的 City 管理配置协议。
 *
 * Schema 只提供可选的默认模型选择；模型发现和实际调用能力均来自运行时上下文。
 */

import type { JsonObject } from "@downcity/agent";

/** Image Plugin profile 的标准 JSON Schema。 */
export const IMAGE_PLUGIN_CONFIG_JSON_SCHEMA: JsonObject = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Image Plugin",
  description: "Optional image generation defaults.",
  properties: {
    default_model: {
      type: "string",
      title: "Default model",
      description: "Model used when an image request does not select one.",
      minLength: 1,
    },
  },
  additionalProperties: false,
};
