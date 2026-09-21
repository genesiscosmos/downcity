/**
 * `@downcity/powers/web` 独立公开入口。
 *
 * 关键点（中文）：汇总 provider-neutral WebPower 与 Playwright/CDP provider。
 */

export { WebPower } from "./web/Power.js";
export { PlaywrightBrowserProvider } from "./web/providers/PlaywrightBrowserProvider.js";
export { LocalBrowserProvider } from "./web/providers/LocalBrowserProvider.js";
export { TavilySearchProvider } from "./web/providers/TavilySearchProvider.js";
export { ExaSearchProvider } from "./web/providers/ExaSearchProvider.js";
export { FetchDocumentProvider } from "./web/providers/FetchDocumentProvider.js";
export { FirecrawlDocumentProvider } from "./web/providers/FirecrawlDocumentProvider.js";
export { SemanticBrowserProviderAdapter } from "./web/providers/SemanticBrowserProviderAdapter.js";
export { ComputerUseBrowserProviderAdapter } from "./web/providers/ComputerUseBrowserProviderAdapter.js";
export { WEB_POWER_ACTIONS } from "./web/types/WebPower.js";
export type {
  BrowserActInput,
  BrowserAction,
  BrowserCloseSessionInput,
  BrowserCreateSessionInput,
  BrowserElementReference,
  BrowserExtractInput,
  BrowserExtractResult,
  BrowserListSessionsResult,
  BrowserObservation,
  BrowserObserveInput,
  BrowserProvider,
  BrowserProviderFactory,
  BrowserProviderScope,
  BrowserSemanticActInput,
  BrowserSemanticExtractInput,
  BrowserSessionSummary,
  WebOpenInput,
  WebOpenResult,
  WebDocumentProvider,
  WebPowerActionName,
  WebPowerOptions,
  WebPowerConfig,
  WebPowerStatusResult,
  WebSearchInput,
  WebSearchItem,
  WebSearchResult,
  WebSearchProvider,
} from "./web/types/WebPower.js";
export type {
  WebMainviewAgent,
  WebMainviewCapabilityStatus,
  WebMainviewSession,
  WebMainviewSessionsInput,
  WebMainviewSessionsResult,
  WebMainviewSnapshot,
  WebMainviewSnapshotInput,
  WebMainviewWorkspace,
} from "./web/types/WebMainview.js";
export type { PlaywrightBrowserProviderOptions } from "./web/types/PlaywrightBrowserProvider.js";
export type {
  ExaSearchProviderOptions,
  FetchDocumentProviderOptions,
  FirecrawlDocumentProviderOptions,
  LocalBrowserProviderOptions,
  TavilySearchProviderOptions,
  WebHttpProviderOptions,
} from "./web/types/WebProviderOptions.js";
export type { SemanticBrowserProviderAdapterOptions } from "./web/types/SemanticBrowserProviderAdapter.js";
export type {
  ComputerUseBrowserProviderAdapterOptions,
  ComputerUseBrowserProviderMethods,
  ComputerUseBrowserRunInput,
} from "./web/types/ComputerUseBrowserProviderAdapter.js";
