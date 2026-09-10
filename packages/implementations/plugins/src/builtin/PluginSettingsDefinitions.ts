/** Image 与 Sound Plugin 自己拥有的设置 Mainview 字段定义。 */

import type { PluginSettingsDefinition } from "@/builtin/types/PluginSettings.js";

/** Image Plugin 设置。 */
export const IMAGE_PLUGIN_SETTINGS: PluginSettingsDefinition = {
  title: "Image",
  description: "选择图像生成请求没有显式指定模型时使用的默认模型。",
  fields: [
    { key: "default_model", label: "Default image model", type: "string" },
  ],
};

/** Sound Plugin 设置。 */
export const SOUND_PLUGIN_SETTINGS: PluginSettingsDefinition = {
  title: "Sound",
  description: "配置语音识别和语音合成的默认行为。",
  fields: [
    { key: "default_asr_model", label: "Default ASR model", type: "string" },
    { key: "default_tts_model", label: "Default TTS model", type: "string" },
    { key: "auto_asr", label: "Automatic transcription", description: "收到音频输入后自动执行语音识别。", type: "boolean" },
    { key: "language", label: "Default language", type: "string" },
    { key: "voice", label: "Default voice", type: "string" },
    { key: "format", label: "Default audio format", type: "string" },
  ],
};
