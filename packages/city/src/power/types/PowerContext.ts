/**
 * City Power 运行上下文协议。
 *
 * 设计边界（中文）：
 * - Power 获得可直接调用的受限 Agent、Session 与 Workspace 句柄，而不是自行用 ID 回查对象。
 * - ID 只承担稳定身份、日志和序列化用途；对象句柄承担进程内通信。
 * - Config 与 Storage 均由 City 按当前 Power 绑定，Power 不能越过自身命名空间。
 */

import type { PowerTown } from "@/power/types/PowerTown.js";
import type { SessionDescriptor, SessionUserContent } from "@downcity/type";
import type { WorkspaceShell } from "@/workspace/index.js";
import type { FileSystem } from "@downcity/type";
import type { SessionInteractionPort } from "@downcity/type";
import type { PowerJsonObject, PowerJsonValue } from "./Json.js";
import type { PowerNotificationPublisher } from "./PowerNotification.js";
import type { PowerCall } from "./PowerCall.js";
import type { StepSnapshot } from "./StepSnapshot.js";
import type { PowerActionResult, PowerSnapshot } from "./PowerRuntime.js";
import type { PowerSessionAddress, PowerSessionArchiveInput, PowerSessionArchiveResult, PowerSessionListInput, PowerSessionMetadata, PowerSessionPage } from "./PowerSessionManagement.js";

/** Power 可以写入的日志等级。 */
export type PowerLogLevel = "debug" | "info" | "warn" | "error" | "action";

/** Power 日志的结构化详情；未定义字段会由宿主丢弃。 */
export interface PowerLogDetails {
  /** 单个结构化日志字段。 */
  readonly [key: string]: PowerJsonValue | undefined;
}

/** Power 使用的结构化日志端口。 */
export interface PowerLogger {
  /** 写入一条可等待持久化完成的结构化日志。 */
  log(level: PowerLogLevel, message: string, details?: PowerLogDetails): Promise<void>;
  /** 写入调试日志。 */
  debug(message: string, details?: PowerLogDetails): void;
  /** 写入普通运行日志。 */
  info(message: string, details?: PowerLogDetails): void;
  /** 写入可恢复问题日志。 */
  warn(message: string, details?: PowerLogDetails): void;
  /** 写入失败日志。 */
  error(message: string, details?: PowerLogDetails): void;
}

/** Power 发起 Session prompt 时复用的标准无身份内容片段。 */
export type PowerSessionPromptContent = SessionUserContent;

/** Power 可读取的 Session Turn 最终结果。 */
export interface PowerSessionTurnResult {
  /** Turn 稳定标识。 */
  readonly turn_id: string;
  /** Turn 最终可见文本。 */
  readonly text: string;
  /** Turn 是否成功结束。 */
  readonly success: boolean;
  /** Turn 失败时的错误文本。 */
  readonly error?: string;
}

/** Power 调用 Session prompt 后获得的等待句柄。 */
export interface PowerSessionTurnHandle {
  /** 当前 Turn 稳定标识。 */
  readonly id: string;
  /** 已完成时的同步结果快照。 */
  readonly result: PowerSessionTurnResult | null;
  /** 等待 Turn 收口的 Promise。 */
  readonly finished: Promise<PowerSessionTurnResult>;
}

/** Power 订阅 Session 时收到的结构化变化。 */
export interface PowerSessionMutation extends PowerJsonObject {
  /** Mutation 稳定标识。 */
  readonly mutation_id: string;
  /** Mutation 所属 Session。 */
  readonly session_id: string;
  /** Mutation 层级。 */
  readonly variant: string;
}

/** Power 可直接调用的单个 Session 句柄。 */
export interface PowerSessionHandle extends SessionDescriptor {
  /** Session 稳定标识。 */
  readonly id: string;
  /** Session 创建来源。 */
  readonly type: SessionDescriptor["type"];
  /** 创建方自定义用途。 */
  readonly kind: string;
  /** 已有派生创建引用。 */
  readonly parent?: SessionDescriptor["parent"];
  /** 现有派生工作层级，不由界面猜测。 */
  readonly delegation_depth?: number;
  /** 父创建事实中的类型。 */
  readonly parent_session_type?: SessionDescriptor["parent_session_type"];
  /** 派生工作起始对话。 */
  readonly root_chat_session_id?: string;
  /** Session 绑定的 Workspace 标识。 */
  readonly workspace_id?: string;
  /** 向 Session 提交一条用户输入。 */
  prompt(input: {
    /** 可信宿主绑定的普通输入来源。 */
    readonly actor: import("@downcity/type").SessionPromptActor;
    /** 本次输入的幂等标识。 */
    readonly request_id?: string;
    /** 文本或结构化内容。 */
    readonly query: string | PowerSessionPromptContent[];
  }): Promise<PowerSessionTurnHandle>;
  /** 停止当前 Turn。 */
  stop(): Promise<PowerJsonObject>;
  /** 订阅当前 Session 的后续变化。 */
  subscribe(subscriber: (mutation: PowerSessionMutation) => void | Promise<void>): () => void;
  /** 读取当前 Session 的全部 canonical Message。 */
  messages(): Promise<PowerJsonObject[]>;
  /** 追加一条 Agent 文本消息。 */
  append_agent_message(input: { /** Agent 文本。 */ readonly text: string }): Promise<void>;
}

/** Power 可调用的 Agent Session 集合。 */
export interface PowerSessionCollection {
  /** 分页读取活动会话元数据；不恢复执行器，可按 Workspace 过滤。 */
  list(input?: PowerSessionListInput): Promise<PowerSessionPage>;
  /** 读取活动或已归档会话元数据，不恢复执行器。 */
  metadata(input: PowerSessionAddress): Promise<PowerSessionMetadata>;
  /** 重命名活动会话；归档会话拒绝写入。 */
  rename(input: PowerSessionAddress & { /** 新的用户可见标题。 */ readonly title: string }): Promise<{ /** 已持久化的标题。 */ title: string }>;
  /** 归档空闲会话及其后代；运行、排队或当前执行中的节点由领域服务拒绝。 */
  archive(input: PowerSessionArchiveInput): Promise<PowerSessionArchiveResult>;
  /** 创建属于当前 Agent 的 Session。 */
  create(input?: {
    /** 可选 Session 来源。 */
    readonly type?: SessionDescriptor["type"];
    /** 创建方自定义用途。 */
    readonly kind?: string;
    /** 可信宿主记录的派生关系。 */
    readonly parent?: SessionDescriptor["parent"];
    /** 只允许选择当前 Power 已登记的执行约束；不包含模型配置。 */
    readonly execution_profile?: { /** 配置标识。 */ id: string; /** 精确版本。 */ version: number };
  }): Promise<PowerSessionHandle>;
  /** 恢复属于当前 Agent 的 Session。 */
  get(session_id: string, type?: string): Promise<PowerSessionHandle>;
  /** 读取单个 Session 的运行句柄。 */
  runtime(session_id: string, type?: string): PowerSessionHandle;
  /** 永久删除一个 Session。 */
  remove(session_id: string, type?: string): Promise<boolean>;
}

/** Agent 默认模型的非秘密描述；自定义客户端可以没有可持久化来源。 */
export interface PowerAgentModel {
  /** 模型客户端的运行时标识，用于展示当前执行模型。 */
  readonly id: string;
  /** 可持久化的来源及原始模型标识；自定义客户端未声明来源时为 null。 */
  readonly reference: import("@downcity/type").ModelReference | null;
}

/** Power 可直接调用的 Agent 受限句柄。 */
export interface PowerAgentHandle {
  /** Agent 稳定标识。 */
  readonly id: string;
  /** Agent 用户可见名称。 */
  readonly name: string;
  /** Agent 可选身份与角色列表快照。 */
  readonly role?: readonly string[];
  /** Agent 能力描述。 */
  readonly description: string;
  /** 当前 Agent 默认模型的标识与来源；未配置时为 null，不暴露模型客户端。 */
  readonly model: PowerAgentModel | null;
  /** 当前 Agent 静态指令快照。 */
  readonly instructions: readonly string[];
  /** 当前 Agent 持有的 Session 集合端口。 */
  readonly sessions: PowerSessionCollection;
  /** Agent 的工作委派服务；服务按可信调用身份检查创建者、层级和父子关系。 */
  readonly work: import("@downcity/agent").SessionWorkContract;
}

/** Power 可直接使用的 Workspace 受限句柄。 */
export interface PowerWorkspaceHandle {
  /** Workspace 稳定标识。 */
  readonly id: string;
  /** Workspace 用户可见名称。 */
  readonly name: string;
  /** Workspace 绝对根目录。 */
  readonly path: string;
  /** Workspace 可选 Shell 端口。 */
  readonly shell?: WorkspaceShell;
  /** 当前 Workspace 环境变量；读当前值，与快照不同。 */
  readonly env: Readonly<Record<string, string>>;
}

/** 当前调用所属的 Session Turn 句柄。 */
export interface PowerTurnHandle {
  /** 本次执行代次；仅有实际 Session 执行时提供。 */
  readonly execution_id?: string;
  /** Turn 稳定标识。 */
  readonly id: string;
  /** 当前 Turn 的取消信号。 */
  readonly abort_signal: AbortSignal;
}

/** City 为当前 Power 提供的私有存储。 */
export interface PowerStorage {
  /** 当前作用域的绝对根路径。 */
  readonly path: string;
  /** 受当前作用域根目录约束的文件端口。 */
  readonly files: FileSystem;
}

/**
 * Power 之间的嵌套调用端口。
 *
 * 关键点（中文）：来源身份（Session、Turn、交互端口、取消信号）由容器在构造时闭合，
 * 因此调用方只能指定目标与 payload，无法伪造或丢失调用身份。
 */
export interface PowerCityPowers {
  /** 读取 City 提供给当前 Agent 的指定 Power 定义。 */
  get(power_id: string): unknown | null;
  /** 列出 City 提供给当前 Agent 的 Power 生命周期快照。 */
  snapshots(): PowerSnapshot[];
  /** 调用 City 提供给当前 Agent 的 Power Action。 */
  run_action(input: {
    /** Power ID。 */ readonly power: string;
    /** Action ID。 */ readonly action: string;
    /** 可选 JSON payload。 */ readonly payload?: PowerJsonValue;
  }): Promise<PowerActionResult>;
  /** 在当前调用上下文中运行一个 pipeline hook。 */
  pipeline<TValue extends PowerJsonValue>(point_name: string, value: TValue): Promise<TValue>;
  /** 在当前调用上下文中运行一个 effect hook。 */
  effect<TValue extends PowerJsonValue>(point_name: string, value: TValue): Promise<void>;
}

/** Power 可直接调用的 City 受限句柄。 */
export interface PowerCityHandle {
  /** 当前 City 的稳定标识。 */
  readonly id: string;
  /** City 的 Agent 目录；每次访问均从 City 的当前索引解析。 */
  readonly agents: {
    /** 读取指定 Agent 的调用句柄；不存在时返回 null。 */
    get(agent_id: string): PowerAgentHandle | null;
    /** 列出当前 City 可见的 Agent 句柄。 */
    list(): readonly PowerAgentHandle[];
  };
  /** City 的 Workspace 目录；当前工作区便捷引用也来自该目录。 */
  readonly workspaces: {
    /** 读取指定 Workspace 的调用句柄；不存在时返回 null。 */
    get(workspace_id: string): PowerWorkspaceHandle | null;
    /** 列出当前 City 可见的 Workspace 句柄。 */
    list(): readonly PowerWorkspaceHandle[];
  };
  /** City 的受限 Town 模型与 Service 路由；不暴露连接或身份管理。 */
  readonly town?: PowerTown;
  /** 当前调用绑定的 City Power 端口。 */
  readonly powers: PowerCityPowers;
}

/**
 * 一次 Power 调用的完整环境。
 *
 * 关键点（中文）
 * - 字段按「Power 代码要回答的问题」组织：为谁运行、在哪个工作区、
 *   属于哪次对话与轮次、模型当时看到什么、我现在在做什么、我的私有资源在哪。
 * - `snapshot` 是本步冻结的事实；`call` 是本次调用的身份。两者分开，
 *   因为一个 Step 可以发起多次调用。
 * - 句柄读活值（`workspace.env`），快照读冻结值（`snapshot.workspace_env`），
 *   两者语义不同，都保留。
 * - 由 `PowerContextProvider` 构造；Power 代码只读。
 */
export class PowerContext {
  /** 当前 City 的受限句柄。 */
  readonly city: PowerCityHandle;

  /** 当前 Agent 的受限句柄；`instructions` 是 Agent 身份，不是某一步的快照。 */
  readonly agent: PowerAgentHandle;

  /** 当前 Workspace 的受限句柄；无项目会话时为空。 */
  readonly workspace?: PowerWorkspaceHandle;

  /** 当前调用所属 Session 句柄；非 Session 调用时为空。 */
  readonly session?: PowerSessionHandle;

  /** 当前调用所属 Turn 句柄；非 Turn 调用时为空。 */
  readonly turn?: PowerTurnHandle;

  /** 本步冻结的事实。 */
  readonly snapshot: StepSnapshot;

  /**
   * Downcity 用户级数据根目录。
   *
   * 关键点（中文）
   * - Agent 私有数据位于其 `agents/<agent-id>/` 下，例如技能目录与记忆目录。
   * - 这是容器事实，由 City 直接提供；Power 不应从自身存储路径向上推断。
   */
  readonly data_root_path: string;

  /** 本次调用的身份与执行面。 */
  readonly call: PowerCall;

  /** 当前 Power 在当前 Agent 范围内的私有存储。 */
  readonly storage: PowerStorage;

  /** City 为当前 Agent/Power 作用域解析出的只读业务配置。 */
  readonly config: PowerJsonObject;

  /** 当前执行范围的结构化日志器。 */
  readonly logger: PowerLogger;

  /** 当前 Power 的通知发布端口。 */
  readonly notifications?: PowerNotificationPublisher;

  constructor(input: {
    /** 当前 City 的受限句柄。 */
    readonly city: PowerCityHandle;
    /** 当前 Agent 的受限句柄。 */
    readonly agent: PowerAgentHandle;
    /** 当前 Workspace 的受限句柄；无项目会话时为空。 */
    readonly workspace?: PowerWorkspaceHandle;
    /** 当前调用所属 Session 句柄。 */
    readonly session?: PowerSessionHandle;
    /** 当前调用所属 Turn 句柄。 */
    readonly turn?: PowerTurnHandle;
    /** 本步冻结的事实。 */
    readonly snapshot: StepSnapshot;
    /** Downcity 用户级数据根目录。 */
    readonly data_root_path: string;
    /** 本次调用的身份与执行面。 */
    readonly call: PowerCall;
    /** 当前 Power 私有存储。 */
    readonly storage: PowerStorage;
    /** 当前 Power 业务配置。 */
    readonly config: PowerJsonObject;
    /** 当前执行范围日志器。 */
    readonly logger: PowerLogger;
    /** 当前 Power 通知端口。 */
    readonly notifications?: PowerNotificationPublisher;
  }) {
    this.city = input.city;
    this.agent = input.agent;
    if (input.workspace) this.workspace = input.workspace;
    this.snapshot = input.snapshot;
    this.data_root_path = input.data_root_path;
    this.call = input.call;
    this.storage = input.storage;
    this.config = input.config;
    this.logger = input.logger;
    if (input.session) this.session = input.session;
    if (input.turn) this.turn = input.turn;
    if (input.notifications) this.notifications = input.notifications;
    Object.freeze(this);
  }

  /** 本次调用的取消信号；唯一来源，不再与快照重复。 */
  get abort_signal(): AbortSignal {
    return this.call.abort_signal;
  }
}
