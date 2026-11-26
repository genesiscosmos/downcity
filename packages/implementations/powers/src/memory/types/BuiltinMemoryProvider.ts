/**
 * Builtin Memory Provider 的确定性存储配置与文档类型。
 *
 * 关键点（中文）
 * - Builtin Provider 可以使用任意 MemoryStorageAdapter，不绑定文件系统。
 * - 语义提炼由 Memory Session 完成，Provider 不接收模型 handler。
 */

import type { MemoryRecord, MemoryScope } from "@/memory/types/MemoryProtocol.js";
import type { MemoryStorageAdapter } from "@/memory/types/MemoryStorage.js";

/** 为当前 City Power 实例延迟创建独占 Storage Adapter 的工厂。 */
export type BuiltinMemoryStorageFactory = () => MemoryStorageAdapter | Promise<MemoryStorageAdapter>;

/** 宿主定向检查 Adapter 根之外的旧材料；只返回存在性，不返回正文或文件路径。 */
export type MemoryLegacyScopeProbe = (scope: MemoryScope) => Promise<boolean>;

/** BuiltinMemoryProvider constructor 参数。 */
export interface BuiltinMemoryProviderOptions {
  /** 知识内容实际持久化后调用；覆盖投影、证据、修订与删除。 */
  readonly on_changed?: import("./MemoryChange.js").MemoryChangeHandler;
  /** 预先创建并由 Provider 独占使用的 Storage Adapter。 */
  storage?: MemoryStorageAdapter;

  /** 延迟创建 Agent 级 Storage Adapter 的工厂；不能与 storage 同时提供。 */
  create_storage?: BuiltinMemoryStorageFactory;

  /** 宿主的定向旧材料探针；旧 Profile 等存在于 Adapter 根之外时必须提供，未提供表示材料全部归当前 Adapter 管理。 */
  legacy_scope_probe?: MemoryLegacyScopeProbe;

  /** 宿主存储是否提供 Workspace 范围所需的共享 Store。 */
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

/** 原始正文的固定行号分片。 */
export interface BuiltinMemoryChunk {
  /** 固定记录。 */ memory: MemoryRecord;
  /** 1-based 起始行。 */ start_line: number;
  /** 1-based 结束行。 */ end_line: number;
  /** 原始正文片段。 */ text: string;
}
