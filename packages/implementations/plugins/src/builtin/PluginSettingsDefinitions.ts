/** Sound Plugin 自己拥有的设置 Mainview 字段定义。 */

import type { PluginSettingsDefinition } from "@/builtin/types/PluginSettings.js";

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
