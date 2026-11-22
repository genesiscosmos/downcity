/**
 * Activity 的单个主对象身份。只表达领域引用，不携带导航函数、URL 或文件访问权限。
 * 宿主在用户点击时校验目录、读取作用域及访问权限；无对应导航能力时显示 label 纯文本。
 */
export type PowerActivityResource =
  | {
    /** Agent 目录中的对象；委派引用只导航 Agent，不授予其会话读取权限。 */
    readonly type: "agent";
    /** 本次明确返回的稳定 Agent ID。 */
    readonly agent_id: string;
    /** 本次记录中的可读名称；不以技术 ID 代替名称。 */
    readonly label: string;
  }
  | {
    /** 任务对象；执行结果仍属于同一 Task tab。 */
    readonly type: "task";
    /** TaskPower 的稳定 task_id，不使用可变标题定位。 */
    readonly task_id: string;
    /** 已返回的一次执行时间戳；缺省只打开任务。 */
    readonly run_timestamp?: string;
    /** 本次记录中的可读任务名称。 */
    readonly label: string;
  }
  | {
    /** 当前 Agent 可读取的会话；不是 Shell PTY 或外部聊天。 */
    readonly type: "session";
    /** 本次返回或请求明确指定的会话 ID，宿主仍需核验完整身份。 */
    readonly session_id: string;
    /** 会话的来源类型，例如 work 或 chat。 */
    readonly session_type: string;
    /** 本次结果明确返回的 Workspace；不得继承来源聊天的 Workspace。 */
    readonly workspace_id?: string;
    /** 目标归档身份，归档操作必须为 true。 */
    readonly archived: boolean;
    /** 本次记录中的可读标题或本地化会话名称。 */
    readonly label: string;
  }
  | {
    /** City 目录中的工作区对象。 */
    readonly type: "workspace";
    /** 当前目录中核验的稳定 Workspace ID。 */
    readonly workspace_id: string;
    /** 本次记录中的可读工作区名称。 */
    readonly label: string;
  }
  | {
    /** Memory 知识条目，复用已注册 memory_detail Power view。 */
    readonly type: "memory";
    /** 知识的 memory_id；profile_id、job_id 不属于此资源。 */
    readonly memory_id: string;
    /** 明确的知识读取作用域；实际 Agent／Workspace 由可信宿主绑定。 */
    readonly scope: "agent" | "city";
    /** 本次记录中的可读主题。 */
    readonly label: string;
  };
