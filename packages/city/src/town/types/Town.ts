/**
 * Town 的连接、身份、宿主登录与持久任务契约。
 * City 不持有账户数据库或秘密；宿主核验身份后以稳定 scope 提交连接。
 */
import type { Downtown, FederationUser, FederationAccountProvider } from "@downcity/downtown";
import type { TownImageJobStore, TownImageJobOrigin } from "./TownImageJobs.js";

/** 注册关系的非秘密身份事实。 */
export interface TownRegistrationOptions {
  /** 可改的展示名；不参与路由，缺省使用客户端名称。 */
  name?: string;
  /** 宿主核验并持久分配的授权来源；省略时创建仅在本进程有效的来源。 */
  auth_scope_id?: string;
  /** 来源能否跨进程恢复；只有宿主持久托管的凭据与 scope 才能设为 true。 */
  durable?: boolean;
}

/** 初始注册项与换号时提交的完整注册事实。 */
export interface TownRegistration extends TownRegistrationOptions {
  /** 由宿主创建并最终释放的独立客户端；resolver 只能续期同一主体。 */
  client: Downtown;
}

/** 对宿主和界面公开的非秘密连接投影。 */
export interface TownSource {
  /** 稳定连接标识，不含冒号，改名不改变此值。 */
  connection_id: string;
  /** 可读名称。 */
  name: string;
  /** 当前目标地址；变更地址必须替换身份 scope。 */
  endpoint_url: string;
  /** 已核验主体与目标地址的非秘密授权来源。 */
  auth_scope_id: string;
  /** 当前注册代次；重新注册后旧句柄失效。 */
  revision: number;
  /** 宿主是否能持久恢复这个来源。 */
  durable: boolean;
}

/** 受控用户视图，不提供本地凭据修改或管理员能力。 */
export type TownUser = Pick<FederationUser, "ai" | "payment" | "relay" | "current" | "service" | "list_services" | "describe_service" | "openapi"> & {
  /** 只公开登录方式发现；交互、设备会话与凭据提交由宿主适配器处理。 */
  readonly account: Pick<FederationUser["account"], "providers">;
};

/** 持有旧视图不延长身份有效期；每个请求都经过连接级门禁。 */
export interface TownConnection extends TownSource {
  /** 带 City 来源标签的受控普通用户能力。 */
  readonly user: TownUser;
}

/** 每个目录独立报告的可用性，错误码不包含上游正文或凭据。 */
export interface TownSourceStatus extends TownSource {
  /** 本次来源目录读取是否成功。 */
  status: "available" | "unavailable";
  /** 不可用时的稳定错误码，界面可据此提示登录或重试。 */
  error_code?: string;
}

/** 宿主可在身份提交门禁内持久化，以拒绝晚到回调。 */
export interface TownAuthContext {
  /** 发起交互时的连接与代次快照。 */
  connection: TownSource;
  /** 核验同一事务后提交完整身份；persist 在目标连接封闭期间执行，失败不发布新身份。 */
  commit(registration: TownRegistration, persist?: () => Promise<void>): Promise<TownConnection>;
}

/** 交互输入由宿主解释，不假定浏览器、PKCE 回调或输入组件存在。 */
export interface TownLoginInput {
  /** Downtown 发布的 Provider ID。 */
  provider: string;
  /** 宿主支持的交互参数；不保存到 City 目录。 */
  input?: Record<string, unknown>;
  /** 用户取消本次交互的信号。 */
  signal?: AbortSignal;
}

/** 登录状态不包含凭据；done 必须已在 context.commit 成功提交。 */
export interface TownLoginResult {
  /** 本次宿主交互的结果。 */
  status: "done" | "pending" | "cancelled";
  /** 宿主本地事务标识；不得用跨服务可能重名的远端 login_id 替代。 */
  transaction_id?: string;
}

/** 按连接编排登录，不创建 City 账户体系。 */
export interface TownAuthAdapter {
  /** 可选宿主自定义发现；省略时直接读取目标 Accounts Service 的公开 providers。 */
  login_providers?(connection: TownSource): Promise<FederationAccountProvider[]>;
  /** 完成交互与主体核验，并通过 context.commit 原子提交凭据与注册。 */
  login(context: TownAuthContext, input: TownLoginInput): Promise<TownLoginResult>;
  /** 撤销目标设备会话，并通过 context.commit 提交新的 guest/已退出身份。 */
  logout(context: TownAuthContext): Promise<void>;
}

/** Town 实例配置；所有宿主能力都是显式注入。 */
export interface TownOptions {
  /** 初始连接集合，键为宿主持久化的 connection_id。 */
  connections?: Readonly<Record<string, TownRegistration>>;
  /** 交互登录与凭据持久化适配器；无适配器时拒绝交互登录和退出。 */
  auth?: TownAuthAdapter;
  /** 图片任务来源仓储；缺省仅在当前 Town 内存中有效。 */
  image_jobs?: TownImageJobStore;
  /** 恢复原任务授权，仅用于查询；宿主必须核验 endpoint 与原 scope，不得激活历史身份。 */
  resolve_image_user?: (origin: TownImageJobOrigin, signal?: AbortSignal) => Promise<{
    /** 只允许查询原任务，不提供历史账户的新建或其他计费能力。 */
    ai: Pick<FederationUser["ai"], "image_result">;
  }>;
}

/** 模型或后台工作恢复时传入的执行约束。 */
export interface TownExecutionOptions {
  /** 已确认的非秘密身份绑定；不匹配时拒绝而不自动接受当前账户。 */
  binding_id?: string;
  /** 取消请求及结果消费。 */
  signal?: AbortSignal;
}
