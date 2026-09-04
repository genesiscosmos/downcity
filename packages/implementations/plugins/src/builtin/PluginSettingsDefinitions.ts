/** Web、Image 与 Sound Plugin 自己拥有的设置 Mainview 字段定义。 */

import type { PluginSettingsDefinition } from "@/builtin/types/PluginSettings.js";

/** Web Plugin Profile 设置。 */
export const WEB_PLUGIN_SETTINGS: PluginSettingsDefinition = {
  title: "Web",
  description: "配置浏览器连接与页面观察默认值。未填写 CDP 地址时仍可使用搜索和文档读取。",
  fields: [
    {
      key: "browser",
      label: "Browser provider",
      description: "当前支持 Playwright CDP 连接。",
      type: "select",
      options: [{ value: "playwright", label: "Playwright" }],
    },
    { key: "cdp_url", label: "CDP endpoint", description: "现有浏览器的 HTTP 或 WebSocket 调试地址。", type: "string" },
    { key: "default_url", label: "Default URL", description: "浏览器 Session 没有指定地址时打开的页面。", type: "string" },
    { key: "timeout_ms", label: "Operation timeout (ms)", type: "number", minimum: 1000, maximum: 60000 },
    { key: "max_observation_chars", label: "Observation character limit", type: "number", minimum: 1, maximum: 100000 },
  ],
};

/** Image Plugin Profile 设置。 */
export const IMAGE_PLUGIN_SETTINGS: PluginSettingsDefinition = {
  title: "Image",
  description: "选择图像生成请求没有显式指定模型时使用的默认模型。",
  fields: [
    { key: "default_model", label: "Default image model", type: "string" },
  ],
};

/** Sound Plugin Profile 设置。 */
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
