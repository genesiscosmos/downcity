/**
 * `@downcity/plugins/web` 独立公开入口。
 *
 * 关键点（中文）：汇总 provider-neutral WebPlugin 与 Playwright/CDP provider。
 */

export { WebPlugin } from "./web/Plugin.js";
export { PlaywrightBrowserProvider } from "./web/providers/PlaywrightBrowserProvider.js";
export { SemanticBrowserProviderAdapter } from "./web/providers/SemanticBrowserProviderAdapter.js";
export { ComputerUseBrowserProviderAdapter } from "./web/providers/ComputerUseBrowserProviderAdapter.js";
export { WEB_PLUGIN_ACTIONS } from "./web/types/WebPlugin.js";
export type {
  BrowserActInput,
  BrowserAction,
  BrowserCloseSessionInput,
  BrowserCreateSessionInput,
  BrowserExtractInput,
  BrowserExtractResult,
  BrowserObservation,
  BrowserObserveInput,
  BrowserProvider,
  BrowserSemanticActInput,
  BrowserSemanticExtractInput,
  WebOpenInput,
  WebOpenResult,
  WebPluginActionName,
  WebPluginOptions,
  WebPluginProfile,
  WebSearchInput,
  WebSearchItem,
  WebSearchResult,
} from "./web/types/WebPlugin.js";
export type { PlaywrightBrowserProviderOptions } from "./web/types/PlaywrightBrowserProvider.js";
export type { SemanticBrowserProviderAdapterOptions } from "./web/types/SemanticBrowserProviderAdapter.js";
export type {
  ComputerUseBrowserProviderAdapterOptions,
  ComputerUseBrowserProviderMethods,
  ComputerUseBrowserRunInput,
} from "./web/types/ComputerUseBrowserProviderAdapter.js";
