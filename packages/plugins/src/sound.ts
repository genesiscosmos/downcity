/**
 * `@downcity/plugins/sound` 独立公开入口。
 *
 * 关键点（中文）：只汇总 SoundPlugin 及其模型、ASR、TTS 宿主能力协议类型。
 */

export { SoundPlugin } from "./sound/Plugin.js";
export { SOUND_PLUGIN_CONFIG_JSON_SCHEMA } from "./sound/config/SoundPluginConfig.js";
export type {
  SoundAiService,
  SoundPluginAsrInput,
  SoundPluginAsrResult,
  SoundPluginAsrSegment,
  SoundPluginCapability,
  SoundPluginModel,
  SoundPluginModelsResult,
  SoundPluginOptions,
  SoundPluginProfile,
  SoundPluginTtsInput,
  SoundPluginTtsResult,
} from "./sound/types/SoundPlugin.js";
