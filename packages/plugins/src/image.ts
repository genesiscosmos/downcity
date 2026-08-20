/**
 * `@downcity/plugins/image` 独立公开入口。
 *
 * 关键点（中文）：只汇总 ImagePlugin 及其宿主能力协议类型。
 */

export { ImagePlugin } from "./image/ImagePlugin.js";
export { IMAGE_PLUGIN_CONFIG_JSON_SCHEMA } from "./image/config/ImagePluginConfig.js";
export type {
  ImagePluginContent,
  ImagePluginDefaultModel,
  ImagePluginDefaultModelResolverInput,
  ImagePluginFileContent,
  ImagePluginInput,
  ImagePluginJobCreateResult,
  ImagePluginJobResult,
  ImagePluginJobResultInput,
  ImagePluginJobStatus,
  ImagePluginModel,
  ImagePluginModelsResult,
  ImagePluginOptions,
  ImagePluginProfile,
  ImagePluginResolvedContent,
  ImagePluginResolvedInput,
  ImagePluginResolvedMessage,
  ImagePluginResult,
  ImagePluginTextContent,
} from "./image/types/ImagePlugin.js";
