/**
 * Builtin Memory Provider 的配置与提炼协议。
 *
 * 关键点（中文）
 * - Builtin Provider 可以使用任意 MemoryStorageAdapter，不绑定文件系统。
 * - digest/revise handler 只处理 Memory 领域数据，不读取物理路径。
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
  /** 文档的人类可读标题；旧记录未声明标题时省略。 */
  title?: string;

  /** 文档承载的记忆类型，用于恢复为领域记录。 */
  memory_type: MemoryType;

  /** 文档内容最初形成或最近被明确保留的 ISO 时间。 */
  observed_at: string;

  /** 支撑当前文档内容的可审计证据引用集合。 */
  source_refs: MemorySourceReference[];
}

/** Session 提炼处理器输入。 */
export interface BuiltinMemoryDigestHandlerInput {
  /** 需要提炼的完整 Session 文本。 */
  source_text: string;

  /** Provider 已保存的稳定证据标识。 */
  source_id: string;

  /** 触发提炼的 Session 标识。 */
  session_id: string;

  /** 当前 Provider 的稳定索引内容。 */
  current_index: string;
}

/** Session 提炼处理器输出。 */
export interface BuiltinMemoryDigestHandlerOutput {
  /** 本次需要创建或更新的长期记忆投影。 */
  projections: BuiltinMemoryProjectionDraft[];

  /** 可选的人类可读结果摘要。 */
  summary?: string;
}

/** Session 提炼处理器。 */
export type BuiltinMemoryDigestHandler = (
  input: BuiltinMemoryDigestHandlerInput,
) => Promise<BuiltinMemoryDigestHandlerOutput | string>;

/** 既有记忆修订处理器输入。 */
export interface BuiltinMemoryReviseHandlerInput {
  /** 需要修订的稳定记忆标识。 */
  memory_id: string;

  /** 当前记忆的完整内容；不存在时为空字符串。 */
  current_content: string;

  /** 描述目标变更的明确修订指令。 */
  instruction: string;

  /** 新增的证据内容。 */
  evidence: string;
}

/** 既有记忆修订处理器输出。 */
export interface BuiltinMemoryReviseHandlerOutput {
  /** 修订后的稳定记忆标识；省略时沿用原标识。 */
  memory_id?: string;

  /** 修订后的完整内容。 */
  content: string;

  /** 可选的人类可读结果摘要。 */
  summary?: string;
}

/** 既有记忆修订处理器。 */
export type BuiltinMemoryReviseHandler = (
  input: BuiltinMemoryReviseHandlerInput,
) => Promise<BuiltinMemoryReviseHandlerOutput | string>;

/** 为当前 City Power 实例延迟创建独占 Storage Adapter 的工厂。 */
export type BuiltinMemoryStorageFactory = () => MemoryStorageAdapter | Promise<MemoryStorageAdapter>;

/** BuiltinMemoryProvider constructor 参数。 */
export interface BuiltinMemoryProviderOptions {
  /** 预先创建并由 Provider 独占使用的 Storage Adapter。 */
  storage?: MemoryStorageAdapter;

  /** 延迟创建 Agent 级 Storage Adapter 的工厂；不能与 storage 同时提供。 */
  create_storage?: BuiltinMemoryStorageFactory;

  /** 当前统一 Adapter 是否同时路由 City 共享 Store。 */
  city_memory_available?: boolean;

  /** 可选的 Session 提炼处理器。 */
  digest?: BuiltinMemoryDigestHandler;

  /** 可选的长期记忆修订处理器。 */
  revise?: BuiltinMemoryReviseHandler;
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
