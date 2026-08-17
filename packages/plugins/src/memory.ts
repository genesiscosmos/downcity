/**
 * `@downcity/plugins/memory` 独立公开入口。
 *
 * 关键点（中文）：汇总 provider-neutral MemoryPlugin、Provider 与内建 Adapter。
 */

export { MemoryPlugin } from "./memory/MemoryPlugin.js";
export { BuiltinMemoryProvider } from "./memory/providers/BuiltinMemoryProvider.js";
export {
  FileMemoryStorageAdapter,
  get_default_file_memory_root_path,
} from "./memory/adapters/FileMemoryStorageAdapter.js";
export type {
  MemoryActionPayload,
  MemoryDigestInput,
  MemoryDigestResult,
  MemoryForgetInput,
  MemoryForgetResult,
  MemoryPluginOptions,
  MemoryPluginProfile,
  MemoryProvider,
  MemoryProviderCapabilities,
  MemoryProviderInitializeInput,
  MemoryProviderState,
  MemoryReadInput,
  MemoryReadResult,
  MemoryRecallInput,
  MemoryRecallItem,
  MemoryRecallResult,
  MemoryRecord,
  MemoryRememberInput,
  MemoryRememberResult,
  MemoryReviseInput,
  MemoryReviseResult,
  MemoryScope,
  MemorySourceReference,
  MemoryStatusResult,
  MemorySystemContextInput,
  MemorySystemContextItem,
  MemorySystemContextResult,
  MemoryType,
} from "./memory/types/Memory.js";
export type {
  BuiltinMemoryDigestHandler,
  BuiltinMemoryDigestHandlerInput,
  BuiltinMemoryDigestHandlerOutput,
  BuiltinMemoryProjectionDraft,
  BuiltinMemoryProviderOptions,
  BuiltinMemoryReviseHandler,
  BuiltinMemoryReviseHandlerInput,
  BuiltinMemoryReviseHandlerOutput,
  BuiltinMemoryStorageFactory,
  DefaultFileMemoryRootInput,
  FileMemoryStorageAdapterOptions,
} from "./memory/types/BuiltinMemoryProvider.js";
export type {
  MemoryStorageAdapter,
  MemoryStorageEntry,
} from "./memory/types/MemoryStorage.js";
