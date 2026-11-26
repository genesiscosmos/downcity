/**
 * `@downcity/powers/memory` 独立公开入口。
 *
 * 关键点（中文）：汇总 provider-neutral MemoryPower、Provider 与内建 Adapter。
 */

export { MemoryPower } from "./memory/MemoryPower.js";
export type { MemoryChange, MemoryChangeHandler } from "./memory/types/MemoryChange.js";
export type { MemoryDreamOptions, MemoryDreamScope, MemoryDreamView, MemorySignalInput } from "./memory/types/MemoryDream.js";
export { BuiltinMemoryProvider } from "./memory/providers/MemoryRecordsProvider.js";
export {
  FileMemoryStorageAdapter,
  get_default_file_memory_root_path,
} from "./memory/adapters/FileMemoryStorageAdapter.js";
export { MemoryStorageRouter } from "./memory/adapters/MemoryStorageRouter.js";
export type {
  MemoryKind, MemoryState, MemoryScope, MemoryScopeType, MemorySource, MemorySourceSelector, MemoryUpdateInput, MemoryWriteResult,
  MemoryActionPayload,
  MemoryDigestInput,
  MemoryForgetInput,
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
  MemoryReviseInput,
  MemoryStatusResult,
} from "./memory/types/MemoryProtocol.js";
export type {
  MemoryAccessContext,
  MemoryKnowledgeAccess,
  MemoryUserAccessContext,
} from "./memory/types/MemoryAccess.js";
export type {
  BuiltinMemoryProviderOptions,
  BuiltinMemoryStorageFactory,
  DefaultFileMemoryRootInput,
  FileMemoryStorageAdapterOptions,
} from "./memory/types/BuiltinMemoryProvider.js";
export type { MemoryJobView, MemoryJobDetail, MemoryJobChangeDetail, MemoryJobSourceExcerpt } from "./memory/types/MemoryJob.js";
export type {
  MemoryChangeSet, MemoryCommitReceipt, MemoryCommitProvider,
  MemoryVersionInput, MemoryVersionResult,
} from "./memory/types/MemoryTransaction.js";
export { MemoryVersionConflictError } from "./memory/types/MemoryTransaction.js";
export type {
  MemoryStorageAdapter,
  MemoryStorageEntry,
} from "./memory/types/MemoryStorage.js";

export { preview_memory_migration, memory_migration_preview_hash, publish_memory_migration } from "./memory/storage/MemoryMigration.js";
export type { MemoryMigrationMaterial, MemoryMigrationCandidate, MemoryMigrationPreview, MemoryMigrationPublishInput, MemoryMigrationPreservation } from "./memory/types/MemoryMigration.js";
