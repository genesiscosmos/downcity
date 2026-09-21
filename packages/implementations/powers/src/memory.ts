/**
 * `@downcity/powers/memory` 独立公开入口。
 *
 * 关键点（中文）：汇总 provider-neutral MemoryPower、Provider 与内建 Adapter。
 */

export { MemoryPower } from "./memory/MemoryPower.js";
export { BuiltinMemoryProvider } from "./memory/providers/BuiltinMemoryProvider.js";
export {
  FileMemoryStorageAdapter,
  get_default_file_memory_root_path,
} from "./memory/adapters/FileMemoryStorageAdapter.js";
export { MemoryStorageRouter } from "./memory/adapters/MemoryStorageRouter.js";
export type {
  MemoryActionPayload,
  MemoryCaptureMessage,
  MemoryCaptureTurnInput,
  MemoryCaptureTurnResult,
  MemoryDigestInput,
  MemoryDigestResult,
  MemoryForgetInput,
  MemoryForgetResult,
  MemoryListItem,
  MemoryListInput,
  MemoryListResult,
  MemoryPowerOptions,
  MemoryProvider,
  MemoryProviderCapabilities,
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
  MemorySourceReference,
  MemoryStatusResult,
  MemorySystemContextInput,
  MemorySystemContextItem,
  MemorySystemContextResult,
  MemoryType,
} from "./memory/types/Memory.js";
export type {
  MemoryAccessContext,
  MemoryOwner,
  MemorySubject,
  MemorySubjectKind,
  MemoryWriteTarget,
} from "./memory/types/MemoryAccess.js";
export type {
  MemoryMainviewAgent,
  MemoryMainviewForgetInput,
  MemoryMainviewListItem,
  MemoryMainviewListInput,
  MemoryMainviewListResult,
  MemoryMainviewMutationResult,
  MemoryMainviewProviderStatus,
  MemoryMainviewReadInput,
  MemoryMainviewReadResult,
  MemoryMainviewRecallInput,
  MemoryMainviewRememberInput,
  MemoryMainviewReviseInput,
  MemoryMainviewSnapshot,
  MemoryMainviewWorkspace,
} from "./memory/types/MemoryMainview.js";
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
