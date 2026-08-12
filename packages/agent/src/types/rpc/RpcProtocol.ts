/**
 * Agent RPC 协议类型。
 *
 * 关键点（中文）
 * - 该文件只描述本机 RPC 的线协议，不包含 socket 或业务执行逻辑。
 * - Client 与 Server 共享同一份 request/frame 类型，避免协议两边漂移。
 * - 字段名保持现有协议格式，兼容已发布的 downcity 托管 runtime 调用。
 */

import type {
  AgentCreateSessionInput,
  AgentListSessionsInput,
  AgentArchiveSessionInput,
  AgentArchiveSessionsInput,
  AgentArchiveSessionResult,
  AgentArchiveSessionsResult,
  AgentCleanArchiveResult,
  AgentSessionSetOptions,
  RemoteSessionSetInput,
  AgentSessionSystemSnapshot,
} from "@/types/agent/SessionTypes.js";
import type { SessionMutation } from "@/types/session/SessionMutation.js";
import type { RespondSessionInteractionInput } from "@/types/session/SessionInteraction.js";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import type { AgentSessionStopResult } from "@/types/sdk/AgentSessionStop.js";
import type { ListSessionMessagesInput } from "@/types/session/SessionMessage.js";
import type { JsonObject, JsonValue } from "@/types/common/Json.js";

/**
 * RPC 请求。
 *
 * 关键点（中文）
 * - `sdk.*` 面向 RemoteAgent 的稳定会话 SDK。
 * - `internal.*` 面向 downcity 本机管理通道。
 */
type RpcRequestPayload =
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 列出 sessions。 */
      method: "sdk.sessions.list";
      /** 列表过滤与分页参数。 */
      params?: AgentListSessionsInput;
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 创建 session。 */
      method: "sdk.sessions.create";
      /** 创建参数。 */
      params?: AgentCreateSessionInput;
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 获取 session。 */
      method: "sdk.sessions.get";
      /** 目标 session 参数。 */
      params: {
        /** 目标 session id。 */
        session_id: string;
      };
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 归档 session。 */
      method: "sdk.sessions.archive";
      /** 归档参数。 */
      params: {
        /** 目标 session id。 */
        session_id: string;
      };
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 列出已归档 sessions。 */
      method: "sdk.sessions.archived.list";
      /** 列表过滤与分页参数。 */
      params?: AgentArchiveSessionsInput;
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 清空已归档 sessions。 */
      method: "sdk.sessions.archived.clean";
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 向 session 发送 prompt。 */
      method: "sdk.sessions.prompt";
      /** prompt 参数。 */
      params: {
        /** 目标 session id。 */
        session_id: string;
        /** SDK prompt 输入。 */
        input: AgentSessionPromptInput;
      };
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 停止当前 session turn。 */
      method: "sdk.sessions.stop";
      /** 停止参数。 */
      params: {
        /** 目标 session id。 */
        session_id: string;
      };
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 把显式历史压缩加入 Session 的有序输入队列。 */
      method: "sdk.sessions.compact";
      /** 目标 Session 参数。 */
      params: {
        /** 目标 session id。 */
        session_id: string;
      };
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 读取 session messages。 */
      method: "sdk.sessions.messages";
      /** messages 查询参数。 */
      params: {
        /** 目标 session id。 */
        session_id: string;
        /** messages 分页参数。 */
        input?: ListSessionMessagesInput;
      };
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 列出指定 Session 正在等待用户响应的 Interaction。 */
      method: "sdk.sessions.interactions";
      /** 目标 Session 参数。 */
      params: { session_id: string };
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 读取指定 Session 的运行与安全状态。 */
      method: "sdk.sessions.status";
      /** 目标 Session 参数。 */
      params: { session_id: string };
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 更新指定 Session 的可序列化动态配置。 */
      method: "sdk.sessions.set";
      /** Session 与动态配置参数。 */
      params: {
        session_id: string;
        input: RemoteSessionSetInput;
        options?: AgentSessionSetOptions;
      };
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 提交指定 Session 的 Interaction 用户响应。 */
      method: "sdk.sessions.respond";
      /** Session 与 Interaction 响应参数。 */
      params: { session_id: string; input: RespondSessionInteractionInput };
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 读取 session system snapshot。 */
      method: "sdk.sessions.system";
      /** 目标 session 参数。 */
      params: {
        /** 目标 session id。 */
        session_id: string;
      };
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 分叉 session。 */
      method: "sdk.sessions.fork";
      /** 分叉参数。 */
      params: {
        /** 源 session id。 */
        session_id: string;
        /** 可选源消息 id。 */
        message_id?: string;
      };
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 订阅 session 事件。 */
      method: "sdk.sessions.subscribe";
      /** 订阅参数。 */
      params: {
        /** 目标 session id。 */
        session_id: string;
      };
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 取消 session 事件订阅。 */
      method: "sdk.sessions.unsubscribe";
      /** 取消订阅参数。 */
      params: {
        /** 当前订阅 id。 */
        subscription_id: string;
      };
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 读取 City 宿主进程状态，不绑定具体 Agent。 */
      method: "internal.city.status";
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 读取 Agent 内部状态。 */
      method: "internal.status.get";
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 让宿主从事实源重新加载 Workspace Env。 */
      method: "internal.workspace.reload_env";
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 清空 session messages。 */
      method: "internal.sessions.clear_messages";
      /** 目标 session 参数。 */
      params: {
        /** 目标 session id。 */
        session_id: string;
      };
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 清空 chat history。 */
      method: "internal.sessions.clear_chat_history";
      /** 目标 session 参数。 */
      params: {
        /** 目标 session id。 */
        session_id: string;
      };
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 解析 session system prompt。 */
      method: "internal.sessions.resolve_system_prompt";
      /** 目标 session 参数。 */
      params: {
        /** 目标 session id。 */
        session_id: string;
      };
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 列出 plugin catalog。 */
      method: "internal.plugins.catalog";
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 列出 plugin 状态。 */
      method: "internal.plugins.list";
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 检查 plugin 可用性。 */
      method: "internal.plugins.availability";
      /** plugin 参数。 */
      params: {
        /** plugin 名称。 */
        plugin_name: string;
      };
    }
  | {
      /** 请求 id，用于匹配响应。 */
      id: string;
      /** 执行 plugin action。 */
      method: "internal.plugins.action";
      /** plugin action 参数。 */
      params: {
        /** plugin 名称。 */
        plugin_name: string;
        /** action 名称。 */
        action_name: string;
        /** action payload。 */
        payload?: JsonValue;
      };
    };

/**
 * RPC 请求。
 *
 * `agent_id` 由 `RemoteAgent(rpc://host:port/<agent_id>)` 自动附加，供 City 级
 * RPC Server 在同一端口内选择 Agent。独立 `AgentRPC` 不要求该字段。
 */
export type RpcRequest = RpcRequestPayload & {
  /** 目标 Agent 的稳定 ID；CityRPC 请求必须提供。 */
  agent_id?: string;
};

/**
 * RPC 成功响应帧。
 */
export interface RpcSuccessFrame {
  /** 请求 id。 */
  id: string;
  /** 成功标记。 */
  success: true;
  /** 响应数据。 */
  data?: unknown;
}

/**
 * RPC 失败响应帧。
 */
export interface RpcErrorFrame {
  /** 请求 id。 */
  id: string;
  /** 失败标记。 */
  success: false;
  /** 错误信息。 */
  error: string;
}

/**
 * RPC 普通响应帧。
 */
export type RpcResponseFrame = RpcSuccessFrame | RpcErrorFrame;

/**
 * RPC 订阅 ready 帧。
 */
export interface RpcReadyFrame {
  /** 帧类型。 */
  type: "ready";
  /** 当前订阅 id。 */
  subscription_id: string;
}

/**
 * RPC 事件帧。
 */
export interface RpcEventFrame {
  /** 帧类型。 */
  type: "event";
  /** 当前订阅 id。 */
  subscription_id: string;
  /** session 事件。 */
  event: SessionMutation;
}

/**
 * RPC server 可写帧。
 */
export type RpcServerFrame = RpcSuccessFrame | RpcErrorFrame | RpcEventFrame;

/**
 * RPC client 可读帧。
 */
export type RpcClientFrame = RpcResponseFrame | RpcReadyFrame | RpcEventFrame;

/**
 * RPC endpoint。
 */
export interface RpcClientEndpoint {
  /** RPC host。 */
  host: string;
  /** RPC port。 */
  port: number;
  /** City RPC 中的目标 Agent ID；独立 AgentRPC 可省略。 */
  agent_id?: string;
}

/** Agent 本机 internal.status.get 返回的进程身份。 */
export interface RpcInternalStatus {
  /** RPC 服务健康状态。 */
  status: string;
  /** RPC 服务所属进程的操作系统 pid。 */
  pid: number;
  /** 当前 Agent 的稳定全局 ID。 */
  agent_id: string;
  /** 当前 Agent 绑定的 Workspace 绝对路径。 */
  workspace_path: string;
  /** daemon 启动实例 ID；非 daemon 前台进程返回空字符串。 */
  instance_id: string;
}

/** City daemon internal.city.status 返回的宿主身份。 */
export interface RpcCityInternalStatus {
  /** RPC 服务健康状态。 */
  status: string;
  /** City 宿主进程 ID。 */
  pid: number;
  /** 当前 City 加载的 Agent ID。 */
  agent_ids: string[];
  /** daemon 启动实例 ID。 */
  instance_id: string;
}

/**
 * RPC Session 订阅句柄。
 */
export interface RpcSessionSubscription {
  /** 当前订阅 id。 */
  subscription_id: string;
  /** 取消订阅。 */
  unsubscribe(): Promise<void>;
}

/**
 * RPC system prompt 分段条目。
 */
export interface RpcSystemPromptSectionItem {
  /** 消息序号。 */
  index: number;
  /** system message 文本内容。 */
  content: string;
}

/**
 * RPC system prompt 分段。
 */
export interface RpcSystemPromptSection {
  /** 分段稳定 key。 */
  key: string;
  /** 分段展示标题。 */
  title: string;
  /** 分段内消息条目。 */
  items: RpcSystemPromptSectionItem[];
}

/**
 * RPC system prompt 响应。
 */
export interface RpcSystemPromptPayload {
  /** 请求是否成功。 */
  success?: boolean;
  /** 当前 session id。 */
  session_id: string;
  /** system message 总数。 */
  total_messages: number;
  /** system message 总字符数。 */
  total_chars: number;
  /** system message 分段。 */
  sections: RpcSystemPromptSection[];
}

/**
 * RPC session system snapshot 响应。
 */
export interface RpcSessionSystemResult {
  /** system snapshot。 */
  system: AgentSessionSystemSnapshot;
}
