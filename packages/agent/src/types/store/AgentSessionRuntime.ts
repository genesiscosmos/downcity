/**
 * Agent Session 存储进程运行时的资源租约协议。
 * 浏览和执行各持有自己的租约，释放执行器不提前释放仍在浏览的唯一存储拥有者。
 */
import type { AgentSessionDatabase } from "@/session/storage/agent-db/AgentSessionDatabase.js";
import type { AgentSessionReadCommand, AgentSessionWriteCommand } from "./AgentSessionWorker.js";

/** 宿主或 SessionStore 请求的存储作用域。 */
export interface AgentSessionRuntimeTarget {
  /** Agent 稳定身份。 */
  agent_id: string;
  /** 绝对 sessions.db 路径；内存库为 :memory:。 */
  database_path: string;
  /** 内存库共享作用域，必须由同 AgentStorage 持有者稳定提供。 */
  memory_scope?: string;
  /** 只有显式创建/新根允许目标初始化，浏览租约始终 false。 */
  allow_create?: boolean;
}

/** 最后一个引用关闭前共享的目标拥有者。 */
export interface AgentSessionRuntimeOwner {
  /** 唯一规范化目标参数。 */
  target: AgentSessionRuntimeTarget;
  /** 浏览与执行的总租约数。 */
  references: number;
  /** 内存模式唯一数据库；不能分配到不同 Worker。 */
  memory?: AgentSessionDatabase;
  /** 只有真正派发过文件写操作才需要向写池发送关闭连接请求。 */
  writer_opened?: boolean;
  /** 最后租约释放时的目标关闭，重入获取必须等待。 */
  closing?: Promise<void>;
}

/** 只读或写入使用者独立持有并释放的最小能力。 */
export interface AgentSessionRuntimeLease {
  /** 查询 canonical 事实，不创建执行器；不存在时稳定报错。 */
  read<T>(operation: AgentSessionReadCommand, signal?: AbortSignal): Promise<T>;
  /** 提交固定语义短事务；只读租约调用直接拒绝。 */
  write<T>(session_id: string, operation: AgentSessionWriteCommand, options?: AgentSessionRuntimeWriteOptions): Promise<T>;
  /** 等待本租约已接受工作完成，随后释放资源引用；失败继续收口并汇总报告。 */
  release(): Promise<void>;
}

/** 只在主线程 Session 接收检查点使用的调度选项。 */
export interface AgentSessionRuntimeWriteOptions {
  /** 仅取消尚未派发的写请求。 */
  signal?: AbortSignal;
  /** 派发前验证 Session 是否仍可接收；不在 SQLite 事务内执行。 */
  assert_dispatchable?: () => void;
}
