/**
 * Builtin Memory Provider 的确定性存储配置与文档类型。
 *
 * 关键点（中文）
 * - Builtin Provider 可以使用任意 MemoryStorageAdapter，不绑定文件系统。
 * - 语义提炼由 Memory Session 完成，Provider 不接收模型 handler。
 */

import type {
  MemoryRecord,
  MemorySourceReference,
  MemoryType,
} from "@/memory/types/Memory.js";
import type { MemoryStorageAdapter } from "@/memory/types/MemoryStorage.js";

/** Builtin Provider 待写入的长期记忆投影。 */
export interface BuiltinMemoryProjectionDraft {
  /** 可选目标 memory_id；省略时由 Provider 根据标题生成。 */
  memory_id?: string;

  /** 可选的人类可读标题。 */
  title?: string;

  /** 需要保存的完整 Markdown 内容。 */
  content: string;

  /** 可选的内容标签集合。 */
  tags?: string[];
}

/** Builtin Provider 内部使用的有界文本片段。 */
export interface BuiltinMemoryChunk {
  /** 当前片段所属记录。 */
  memory: MemoryRecord;

  /** 当前片段起始行号。 */
  start_line: number;

  /** 当前片段结束行号。 */
  end_line: number;

  /** 当前片段文本。 */
  text: string;
}

/** Builtin Memory Markdown 文档解析后的稳定元数据。 */
export interface BuiltinMemoryMetadata {
  /** 仅允许此 Agent 使用的用户偏好；省略为全授权 Agent。 */
  applicable_agent_id?: string;
  /** 文档的人类可读标题；旧记录未声明标题时省略。 */
  title?: string;

  /** 文档承载的记忆类型，用于恢复为领域记录。 */
  memory_type: MemoryType;

  /** 文档内容最初形成或最近被明确保留的 ISO 时间。 */
  observed_at: string;

  /** 文档关联的 Workspace；只作为 metadata，不参与 Subject 隔离。 */
  workspace_id?: string;

  /** 支撑当前文档内容的可审计证据引用集合。 */
  source_refs: MemorySourceReference[];
}

/** 为当前 City Power 实例延迟创建独占 Storage Adapter 的工厂。 */
export type BuiltinMemoryStorageFactory = () => MemoryStorageAdapter | Promise<MemoryStorageAdapter>;

/** BuiltinMemoryProvider constructor 参数。 */
export interface BuiltinMemoryProviderOptions {
  /** 知识内容实际持久化后调用；覆盖投影、证据、修订与删除。 */
  readonly on_changed?: import("./MemoryChange.js").MemoryChangeHandler;
  /** 预先创建并由 Provider 独占使用的 Storage Adapter。 */
  storage?: MemoryStorageAdapter;

  /** 延迟创建 Agent 级 Storage Adapter 的工厂；不能与 storage 同时提供。 */
  create_storage?: BuiltinMemoryStorageFactory;

  /** 当前统一 Adapter 是否同时路由 City 共享 Store。 */
  city_memory_available?: boolean;

}

/** FileMemoryStorageAdapter constructor 参数。 */
export interface FileMemoryStorageAdapterOptions {
  /** 当前 Adapter 独占的绝对存储根目录。 */
  root_path: string;
}

/** Builtin File Adapter 默认根目录解析参数。 */
export interface DefaultFileMemoryRootInput {
  /** 宿主提供的用户级平台数据根目录。 */
  platform_root_path: string;

  /** 当前 Agent 的稳定全局标识。 */
  agent_id: string;
}
