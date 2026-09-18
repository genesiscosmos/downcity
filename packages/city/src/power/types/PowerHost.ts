/**
 * Power 生命周期可使用的 City 宿主能力。
 *
 * Power 由 City 持有一个实例，并在 `initialize` 中注册管理动作、初始化全局资源；
 * `dispose` 使用同一个稳定上下文完成释放。这里不再声明第二套 main 生命周期。
 */

import type {
  PowerLogger,
  PowerSessionMutation,
  PowerSessionPromptContent,
  PowerSessionTurnResult,
  PowerStorage,
} from "./PowerContext.js";
import type { PowerJsonObject, PowerJsonValue } from "./Json.js";
import type { PowerNotificationPublisher } from "./PowerNotification.js";

/** Power 注册的一个 Sidebar/Mainview 业务动作。 */
export interface PowerHostAction {
  /** Power 内稳定且唯一的动作 ID。 */
  readonly id: string;
  /** 执行动作；输入和输出必须可以序列化为 JSON。 */
  readonly run: (input: PowerJsonValue | undefined) =>
    PowerJsonValue | Promise<PowerJsonValue>;
}

/** Power 注册的一个配置动作。 */
export interface PowerConfigAction {
  /** Power 内稳定且唯一的动作 ID。 */
  readonly id: string;
  /** 在当前 Power 配置范围内执行动作。 */
  readonly run: (
    input: PowerJsonValue | undefined,
    context: PowerConfigActionContext,
  ) => PowerJsonValue | Promise<PowerJsonValue>;
}

/** 当前 Power 唯一配置的存储端口。 */
export interface PowerConfigStore {
  /** 同步读取当前 Power 的完整配置快照。 */
  get(): PowerJsonObject;
  /** 原子替换当前 Power 的完整配置。 */
  set(config: PowerJsonObject): Promise<void>;
}

/** Power 在 City 生命周期中发起的一次 Agent Session Turn。 */
export interface PowerHostSessionTurn {
  /** 当前 Session 的稳定 ID。 */
  readonly session_id: string;
  /** 当前 Turn 的稳定 ID。 */
  readonly turn_id: string;
  /** 等待 Turn 完成并返回稳定结果。 */
  readonly finished: Promise<PowerSessionTurnResult>;
  /** 订阅当前 Session 后续变化；返回取消订阅函数。 */
  subscribe(subscriber: (mutation: PowerSessionMutation) => void | Promise<void>): () => void;
  /** 请求停止当前 Session 正在执行的 Turn。 */
  stop(): Promise<void>;
}

/** 每次配置动作调用获得的动态上下文。 */
export interface PowerConfigActionContext {
  /** 已绑定当前 Power 身份的唯一配置存储。 */
  readonly config: PowerConfigStore;
}

/** 宿主登记且允许 Power 感知的 Workspace。 */
export interface PowerHostWorkspace {
  /** Workspace 的稳定 ID。 */
  readonly workspace_id: string;
  /** Workspace 的用户可见名称。 */
  readonly name: string;
  /** Workspace 的绝对根路径。 */
  readonly workspace_path: string;
}

/** Power 可管理的宿主 Agent 摘要。 */
export interface PowerHostAgent {
  /** Agent 的稳定 ID。 */
  readonly agent_id: string;
  /** Agent 的用户可见名称。 */
  readonly name: string;
}

/** Power 可使用的宿主系统能力。 */
export interface PowerHostSystem {
  /** 列出宿主当前登记的 Agent。 */
  list_agents(): Promise<PowerHostAgent[]>;
  /** 列出宿主当前登记的 Workspace。 */
  list_workspaces(): Promise<PowerHostWorkspace[]>;
  /** 在指定 Agent 与 Workspace 上调用一个 Power action。 */
  invoke_agent_power(input: {
    /** 目标 Agent 的稳定 ID。 */
    readonly agent_id: string;
    /** 提供执行上下文的 Workspace ID。 */
    readonly workspace_id: string;
    /** 目标 Power ID。 */
    readonly power_id: string;
    /** 目标 action ID。 */
    readonly action_id: string;
    /** 传递给 action 的可选 JSON 输入。 */
    readonly input?: PowerJsonValue;
  }): Promise<PowerJsonValue>;
  /** 在指定 Agent 与 Workspace 下创建一个新的 Session。 */
  create_agent_session(input: {
    /** 持有新 Session 的 Agent 稳定 ID。 */
    readonly agent_id: string;
    /** 新 Session 绑定的 Workspace 稳定 ID。 */
    readonly workspace_id: string;
    /** 新 Session 的来源及其业务路由元数据。 */
    readonly origin: { readonly type: string; readonly [key: string]: PowerJsonValue };
  }): Promise<{ readonly session_id: string }>;
  /** 在指定 Agent 与 Workspace 上恢复或创建 Session，并提交一次用户输入。 */
  prompt_agent_session(input: {
    /** 持有目标 Session 的 Agent 稳定 ID。 */
    readonly agent_id: string;
    /** 本次 Session 执行使用的 Workspace 稳定 ID。 */
    readonly workspace_id: string;
    /** 目标 Session 的稳定 ID。 */
    readonly session_id: string;
    /** Session 的持久化来源分区。 */
    readonly origin_type: string;
    /** 同一 Session 内标识本次业务输入的稳定幂等键。 */
    readonly request_id?: string;
    /** 提交给 Session 的文本或结构化内容。 */
    readonly query: string | PowerSessionPromptContent[];
  }): Promise<PowerHostSessionTurn>;
  /** 向指定 Agent 持有的既有 Session 追加一条外部 Assistant 消息。 */
  append_agent_session_message(input: {
    /** 持有目标 Session 的 Agent 稳定 ID。 */
    readonly agent_id: string;
    /** 目标 Session 创建时绑定的 Workspace 稳定 ID。 */
    readonly workspace_id: string;
    /** 目标 Session 的稳定 ID。 */
    readonly session_id: string;
    /** 目标 Session 的来源分区。 */
    readonly origin_type: string;
    /** 要追加的纯文本消息。 */
    readonly text: string;
  }): Promise<void>;
  /** 使用系统默认应用打开 HTTP 或 HTTPS 地址。 */
  open_external(input: {
    /** 要打开的绝对 URL。 */
    readonly url: string;
  }): Promise<void>;
  /** 在系统文件管理器中显示一个绝对路径。 */
  show_item_in_folder(input: {
    /** 要显示的绝对文件路径。 */
    readonly path: string;
  }): Promise<void>;
  /** 把纯文本写入系统剪贴板。 */
  write_clipboard_text(input: {
    /** 要写入剪贴板的文本。 */
    readonly text: string;
  }): Promise<void>;
}

/** Power 对自身宿主动作的受限注册能力。 */
export interface PowerSelf {
  /** 当前 Power 的稳定 ID。 */
  readonly id: string;
  /** 注册一个供 Sidebar/Mainview 调用的业务动作。 */
  action(action: PowerHostAction): void;
  /** 注册一个供 Config 调用的配置动作。 */
  config_action(action: PowerConfigAction): void;
}

/** Power 加入 City 后在完整 City 生命周期内持有的稳定上下文。 */
export interface PowerLifecycleContext {
  /** 当前 Power 的自身能力。 */
  readonly power: PowerSelf;
  /** 当前 Power 在 City 中唯一的结构化配置存储。 */
  readonly config: PowerConfigStore;
  /** 当前 Power 在 City 中唯一的私有存储。 */
  readonly storage: PowerStorage;
  /** Power 独享的结构化日志器。 */
  readonly logger: PowerLogger;
  /** 已绑定当前 Power 身份的宿主通知发布能力。 */
  readonly notifications: PowerNotificationPublisher;
  /** 明确授权的宿主系统辅助能力。 */
  readonly system: PowerHostSystem;
}
