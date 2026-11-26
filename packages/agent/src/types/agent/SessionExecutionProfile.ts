/**
 * 宿主可信的 Session 执行配置协议。
 * 配置替换指令、Composer、工具和执行限制；模型始终属于 Agent。
 */
import type { AgentTool, SessionDescriptor, ToolHookSet } from "@downcity/type";
import type { SessionComposer } from "@/types/session/SessionComposer.js";

/** 随 Session 持久化的不可变执行身份。 */
export interface SessionExecutionProfileReference {
  /** 宿主注册的稳定配置标识。 */
  id: string;
  /** 配置实现版本；恢复时必须精确匹配。 */
  version: number;
  /** 宿主业务创建键；存在时用于崩溃后的幂等创建。 */
  creation_key?: string;
}

/** 宿主解析配置时可见的 Session 身份；所有范围由宿主确定。 */
export interface SessionExecutionProfileContext extends SessionDescriptor {
  /** 持有当前 Session 的真实 Agent。 */
  agent_id: string;
  /** 已分配的稳定 Session ID，可用于工具闭包绑定。 */
  session_id: string;

  /** 宿主创建时固定的业务键；恢复时沿用记录中的值，供配置绑定私有业务对象。 */
  creation_key?: string;
  /** 可选范围元数据，不自动授予 Workspace 能力。 */
  workspace_id?: string;
}

/** 一次 Session 使用的完整受限执行资源。 */
export interface SessionExecutionProfileResources {
  /** 提供时替换 Agent 指令；省略时沿用 Agent 指令。 */
  instruction?: string[];
  /** 提供时使用专用 Composer；省略时沿用 Agent Composer。 */
  composer?: SessionComposer;
  /** 提供时作为完整工具白名单；省略时沿用 Agent 已授权工具。 */
  tools?: Record<string, AgentTool>;
  /** 提供时替换 hooks；省略时沿用 Agent 的 hooks。 */
  hooks?: ToolHookSet;
}

/** 仅供宿主注册的可信执行配置；模型输入不能提供此对象。 */
export interface SessionExecutionProfile {
  /** 配置稳定标识。 */
  id: string;
  /** 配置实现的正整数版本。 */
  version: number;
  /** 按持久化身份解析专用资源；恢复时只装配能力与限制。 */
  resolve(context: SessionExecutionProfileContext): SessionExecutionProfileResources | Promise<SessionExecutionProfileResources>;
}

/** 宿主创建 Session 时指定的执行配置引用。 */
export interface SessionExecutionProfileSelection {
  /** 已注册配置的稳定标识。 */
  execution_profile_id: string;
  /** 已注册配置的精确版本。 */
  execution_profile_version: number;
  /** 可选稳定业务创建键。 */
  creation_key?: string;
}

/** 已完成解析并可直接装配的执行配置。 */
export interface ResolvedSessionExecutionProfile {
  /** 不可变持久化执行身份。 */
  reference: SessionExecutionProfileReference;
  /** 当前进程解析出的可信执行资源。 */
  resources: SessionExecutionProfileResources;
}
