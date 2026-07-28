/**
 * City 内建 Plugin 的静态 Catalog 定义。
 *
 * 关键点（中文）
 * - 内建 Plugin 与外部 Manifest 最终都归一化为同一种 Catalog 数据。
 * - Chat Schema 来自 `@downcity/plugins/chat` 的 Zod 唯一源码，这里不复制字段。
 */

import type { CityBuiltinPluginCatalogDefinition } from "@/city/types/plugin/CityBuiltinPlugin.js";
import { CHAT_PLUGIN_CONFIG_JSON_SCHEMA } from "@downcity/plugins/chat";

/** 全部 City 内建 Plugin 的 Binding 协议。 */
export const CITY_BUILTIN_PLUGIN_CATALOG: readonly CityBuiltinPluginCatalogDefinition[] = [
  {
    plugin_name: "skill",
    title: "Skill Catalog And Loader",
    description: "Lists and reads local skills, and injects discovery guidance.",
    actions: ["find", "install", "list", "lookup"],
    default_config: {},
  },
  {
    plugin_name: "web",
    title: "Web Methodology",
    description: "Injects web research and browser-use methodology for Agents.",
    actions: ["install"],
    default_config: {},
  },
  {
    plugin_name: "workboard",
    title: "Workboard Snapshot",
    description: "Collects structured Agent runtime activity snapshots.",
    actions: ["snapshot"],
    default_config: {},
  },
  {
    plugin_name: "chat",
    title: "Chat",
    description: "Connects Agents to Telegram, Feishu, and QQ channels.",
    actions: [
      "access-approve",
      "access-deny",
      "access-revoke",
      "access-set",
      "access-snapshot",
      "context",
      "delete",
      "history",
      "history_clear",
      "info",
      "list",
      "react",
      "reconnect",
      "send",
      "status",
      "test",
    ],
    default_config: {},
    config_schema: CHAT_PLUGIN_CONFIG_JSON_SCHEMA,
  },
  {
    plugin_name: "contact",
    title: "Contact",
    description: "Manages trusted relationships and exchanges with remote Agents.",
    actions: [
      "approve",
      "chat",
      "check",
      "inbox",
      "link",
      "list",
      "receive",
      "remoteapprove",
      "remotechat",
      "remoteconfirm",
      "remoteping",
      "remoteshare",
      "share",
    ],
    default_config: {},
  },
  {
    plugin_name: "task",
    title: "Task",
    description: "Manages reusable tasks and their trigger runtime.",
    actions: ["create", "delete", "disable", "enable", "list", "reload", "run", "status", "update"],
    default_config: {},
  },
  {
    plugin_name: "memory",
    title: "Memory",
    description: "Stores, searches, and revises Agent memories.",
    actions: ["digest", "read", "remember", "revise", "search", "status"],
    default_config: {},
  },
  {
    plugin_name: "image",
    title: "Image",
    description: "Discovers image models, generates images, and reads results.",
    actions: ["image_create", "image_result", "models"],
    default_config: {},
  },
  {
    plugin_name: "sound",
    title: "Sound",
    description: "Discovers speech models and provides ASR and TTS.",
    actions: ["asr", "models", "tts"],
    default_config: {},
  },
];

/** 按名称读取内建 Plugin Catalog 定义。 */
export function get_builtin_plugin_catalog_definition(
  plugin_name: string,
): CityBuiltinPluginCatalogDefinition | null {
  return CITY_BUILTIN_PLUGIN_CATALOG.find((item) => item.plugin_name === plugin_name) ?? null;
}
