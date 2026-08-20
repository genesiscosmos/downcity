/**
 * Sound Plugin 的 City 管理配置协议。
 *
 * Schema 只描述语音 Action 的用户默认值；模型目录与调用实现由运行时上下文提供。
 */

import type { JsonObject } from "@downcity/agent";

/** Sound Plugin profile 的标准 JSON Schema。 */
export const SOUND_PLUGIN_CONFIG_JSON_SCHEMA: JsonObject = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Sound Plugin",
  description: "Optional speech recognition and synthesis defaults.",
  properties: {
    default_asr_model: {
      type: "string",
      title: "Default ASR model",
      minLength: 1,
    },
    default_tts_model: {
      type: "string",
      title: "Default TTS model",
      minLength: 1,
    },
    auto_asr: {
      type: "boolean",
      title: "Automatic transcription",
      default: false,
    },
    language: {
      type: "string",
      title: "Default language",
      minLength: 1,
    },
    voice: {
      type: "string",
      title: "Default voice",
      minLength: 1,
    },
    format: {
      type: "string",
      title: "Default audio format",
      minLength: 1,
    },
  },
  additionalProperties: false,
};
