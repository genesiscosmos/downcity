/**
 * Web Plugin 的 City 管理配置协议。
 *
 * 该 Schema 只描述宿主可持久化的用户配置。浏览器连接是可选能力：没有 CDP
 * 地址时，Web Plugin 仍可提供搜索与文档读取 Action。
 */

import type { JsonObject } from "@downcity/agent";

/** Web Plugin profile 的标准 JSON Schema。 */
export const WEB_PLUGIN_CONFIG_JSON_SCHEMA: JsonObject = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Web Plugin",
  description: "Optional browser connection and observation configuration.",
  properties: {
    browser: {
      type: "string",
      title: "Browser provider",
      description: "Browser provider used when a CDP endpoint is configured.",
      enum: ["playwright"],
      default: "playwright",
    },
    cdp_url: {
      type: "string",
      title: "CDP endpoint",
      description: "Optional HTTP or WebSocket endpoint of an existing browser.",
      minLength: 1,
    },
    default_url: {
      type: "string",
      title: "Default URL",
      description: "Page opened when a browser session does not specify a URL.",
      minLength: 1,
    },
    timeout_ms: {
      type: "integer",
      title: "Operation timeout",
      description: "Maximum browser operation time in milliseconds.",
      minimum: 1000,
      maximum: 60000,
    },
    max_observation_chars: {
      type: "integer",
      title: "Observation limit",
      description: "Maximum number of page observation characters.",
      minimum: 1,
      maximum: 100000,
    },
  },
  additionalProperties: false,
};
