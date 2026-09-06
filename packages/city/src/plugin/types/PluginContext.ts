/**
 * City Plugin 运行上下文协议。
 *
 * 设计边界（中文）：
 * - Plugin 获得可直接调用的受限 Agent、Session 与 Workspace 句柄，而不是自行用 ID 回查对象。
 * - ID 只承担稳定身份、日志和序列化用途；对象句柄承担进程内通信。
 * - Config 与 Storage 均由 City 按当前 Plugin 绑定，Plugin 不能越过自身命名空间。
 */

import type { Embassy } from "@downcity/federation";
import type { FileSystem, WorkspaceShell } from "@/workspace/index.js";
import type { PluginJsonObject, PluginJsonValue } from "./Json.js";
import type { PluginNotificationPublisher } from "./PluginNotification.js";
import type { PluginActionResult, PluginSnapshot } from "./PluginRuntime.js";

/** Plugin 可以写入的日志等级。 */
export type PluginLogLevel = "debug" | "info" | "warn" | "error" | "action";

/** Plugin 日志的结构化详情；未定义字段会由宿主丢弃。 */
export interface PluginLogDetails {
  /** 单个结构化日志字段。 */
  readonly [key: string]: PluginJsonValue | undefined;
}

/** Plugin 使用的结构化日志端口。 */
export interface PluginLogger {
  /** 写入一条可等待持久化完成的结构化日志。 */
  log(level: PluginLogLevel, message: string, details?: PluginLogDetails): Promise<void>;
  /** 写入调试日志。 */
  debug(message: string, details?: PluginLogDetails): void;
  /** 写入普通运行日志。 */
  info(message: string, details?: PluginLogDetails): void;
  /** 写入可恢复问题日志。 */
  warn(message: string, details?: PluginLogDetails): void;
  /** 写入失败日志。 */
  error(message: string, details?: PluginLogDetails): void;
}

/** Plugin 可使用的 Web 服务端口。 */
export interface PluginWebServices {
  /** 搜索公开 Web 内容。 */
  search(input: PluginJsonObject): Promise<PluginJsonValue>;
  /** 读取指定 Web 文档。 */
  open(input: PluginJsonObject): Promise<PluginJsonValue>;
}

/** Plugin 可观察的 Session 来源。 */
export interface PluginSessionOrigin {
  /** 来源类型，同时也是 Session 的持久化分区。 */
  readonly type: string;
  /** 来源协议允许携带的其他 JSON 字段。 */
  readonly [key: string]: PluginJsonValue;
}

/** Plugin 发起 Session prompt 时可提交的内容片段。 */
export type PluginSessionPromptPart =
  | { /** 文本片段。 */ readonly type: "text"; /** 完整文本。 */ readonly text: string }
  | { /** 上下文片段。 */ readonly type: "context"; /** 安全标签名。 */ readonly tag: string; /** 上下文正文。 */ readonly context: string }
  | { /** 文件片段。 */ readonly type: "file"; /** IANA MIME 类型。 */ readonly media_type: string; /** 文件地址。 */ readonly url: string; /** 可选文件名。 */ readonly filename?: string }
  | { /** 数据片段。 */ readonly type: "data"; /** 业务数据类型。 */ readonly data_type: string; /** JSON 数据。 */ readonly data: PluginJsonValue; /** 可选稳定标识。 */ readonly data_id?: string };

/** Plugin 可读取的 Session Turn 最终结果。 */
export interface PluginSessionTurnResult {
  /** Turn 稳定标识。 */
  readonly turn_id: string;
  /** Turn 最终可见文本。 */
  readonly text: string;
  /** Turn 是否成功结束。 */
  readonly success: boolean;
  /** Turn 失败时的错误文本。 */
  readonly error?: string;
}

/** Plugin 调用 Session prompt 后获得的等待句柄。 */
export interface PluginSessionTurnHandle {
  /** 当前 Turn 稳定标识。 */
  readonly id: string;
  /** 已完成时的同步结果快照。 */
  readonly result: PluginSessionTurnResult | null;
  /** 等待 Turn 收口的 Promise。 */
  readonly finished: Promise<PluginSessionTurnResult>;
}

/** Plugin 可读取的 Session 上下文快照。 */
export interface PluginSessionContextSnapshot {
  /** Session 当前累计摘要。 */
  readonly summary?: string;
  /** Session 当前 canonical 消息；具体消息协议由 Agent 定义。 */
  readonly messages: PluginJsonObject[];
}

/** Plugin 订阅 Session 时收到的结构化变化。 */
export interface PluginSessionMutation extends PluginJsonObject {
  /** Mutation 稳定标识。 */
  readonly mutation_id: string;
  /** Mutation 所属 Session。 */
  readonly session_id: string;
  /** Mutation 层级。 */
  readonly variant: string;
  /** Mutation 类型。 */
  readonly type: string;
}

/** Plugin 可直接调用的单个 Session 句柄。 */
export interface PluginSessionHandle {
  /** Session 稳定标识。 */
  readonly id: string;
  /** Session 创建来源。 */
  readonly origin: PluginSessionOrigin;
  /** Session 绑定的 Workspace 标识。 */
  readonly workspace_id?: string;
  /** 向 Session 提交一条用户输入。 */
  prompt(input: { /** 文本或结构化内容。 */ readonly query: string | PluginSessionPromptPart[] }): Promise<PluginSessionTurnHandle>;
  /** 停止当前 Turn。 */
  stop(): Promise<PluginJsonObject>;
  /** 订阅当前 Session 的后续变化。 */
  subscribe(subscriber: (mutation: PluginSessionMutation) => void | Promise<void>): () => void;
  /** 读取当前 Session 的累计摘要与 canonical 消息快照。 */
  context(): Promise<PluginSessionContextSnapshot>;
  /** 追加一条 Assistant 文本消息。 */
  append_assistant_message(input: { /** Assistant 文本。 */ readonly text: string }): Promise<void>;
}

/** Plugin 可调用的 Agent Session 集合。 */
export interface PluginSessionCollection {
  /** 创建属于当前 Agent 的 Session。 */
  create(input?: {
    /** 可选 Session 来源。 */
    readonly origin?: PluginSessionOrigin;
    /** 可选来源 Session；新 Session 会继承其模型选择。 */
    readonly inherit_model_from?: {
      /** 来源 Session 稳定标识。 */ readonly session_id: string;
      /** 来源 Session 的持久化分区。 */ readonly origin_type?: string;
    };
  }): Promise<PluginSessionHandle>;
  /** 恢复属于当前 Agent 的 Session。 */
  get(session_id: string, origin_type?: string): Promise<PluginSessionHandle>;
  /** 读取单个 Session 的运行句柄。 */
  runtime(session_id: string, origin_type?: string): PluginSessionHandle;
  /** 永久删除一个 Session。 */
  remove(session_id: string, origin_type?: string): Promise<boolean>;
}

/** Plugin 可直接调用的 Agent 受限句柄。 */
export interface PluginAgentHandle {
  /** Agent 稳定标识。 */
  readonly id: string;
  /** Agent 用户可见名称。 */
  readonly name: string;
  /** Agent 能力描述。 */
  readonly description: string;
  /** 当前 Agent 静态指令快照。 */
  readonly instructions: readonly string[];
  /** 当前 Agent 持有的 Session 集合端口。 */
  readonly sessions: PluginSessionCollection;
  /** 当前 Agent 可选 Web 服务。 */
  readonly web?: PluginWebServices;
}

/** Plugin 可直接使用的 Workspace 受限句柄。 */
export interface PluginWorkspaceHandle {
  /** Workspace 稳定标识。 */
  readonly id: string;
  /** Workspace 绝对根目录。 */
  readonly path: string;
  /** Workspace 受根目录约束的文件端口。 */
  readonly files: FileSystem;
  /** Workspace 可选 Shell 端口。 */
  readonly shell?: WorkspaceShell;
  /** 当前 Workspace 环境变量快照。 */
  readonly env: Readonly<Record<string, string>>;
}

/** 当前调用所属的 Session Turn 句柄。 */
export interface PluginTurnHandle {
  /** Turn 稳定标识。 */
  readonly id: string;
  /** 当前 Turn 的取消信号。 */
  readonly abort_signal: AbortSignal;
}

/** City 为当前 Plugin 提供的私有存储。 */
export interface PluginStorage {
  /** 当前作用域的绝对根路径。 */
  readonly path: string;
  /** 受当前作用域根目录约束的文件端口。 */
  readonly files: FileSystem;
}

/** Plugin 可调用的 City Plugin 端口。 */
export interface PluginCityPlugins {
  /** 读取 City 提供给当前 Agent 的指定 Plugin 定义。 */
  get(plugin_id: string): unknown | null;
  /** 列出 City 提供给当前 Agent 的 Plugin 生命周期快照。 */
  snapshots(): PluginSnapshot[];
  /** 调用 City 提供给当前 Agent 的 Plugin Action。 */
  run_action(input: {
    /** Plugin ID。 */ readonly plugin: string;
    /** Action ID。 */ readonly action: string;
    /** 可选 JSON payload。 */ readonly payload?: PluginJsonValue;
  }): Promise<PluginActionResult>;
  /** 在当前调用上下文中运行一个 pipeline hook。 */
  pipeline<TValue extends PluginJsonValue>(point_name: string, value: TValue): Promise<TValue>;
  /** 在当前调用上下文中运行一个 effect hook。 */
  effect<TValue extends PluginJsonValue>(point_name: string, value: TValue): Promise<void>;
}

/** Plugin 可直接调用的 City 受限句柄。 */
export interface PluginCityHandle {
  /** City 的 Federation Embassy；未配置时为空。 */
  readonly embassy?: Embassy;
  /** 当前调用绑定的 City Plugin 端口。 */
  readonly plugins: PluginCityPlugins;
}

/** Plugin Action、Hook 与 system provider 共用的动态上下文。 */
export interface PluginContext {
  /** 当前 City 的受限句柄。 */
  readonly city: PluginCityHandle;
  /** 当前 Agent 的受限句柄。 */
  readonly agent: PluginAgentHandle;
  /** 当前 Workspace 的受限句柄。 */
  readonly workspace: PluginWorkspaceHandle;
  /** 当前调用所属 Session；非 Session 调用时为空。 */
  readonly session?: PluginSessionHandle;
  /** 当前调用所属 Turn；非 Turn 调用时为空。 */
  readonly turn?: PluginTurnHandle;
  /** 当前 Plugin 在当前 Agent 范围内的私有存储。 */
  readonly storage: PluginStorage;
  /** City 为当前 Agent/Plugin 作用域解析出的只读业务配置。 */
  readonly config: PluginJsonObject;
  /** 当前执行范围的结构化日志器。 */
  readonly logger: PluginLogger;
  /** 当前 Plugin 的通知发布端口。 */
  readonly notifications?: PluginNotificationPublisher;
  /** 当前调用取消信号；非 Turn 调用由 City 创建。 */
  readonly abort_signal: AbortSignal;
}
