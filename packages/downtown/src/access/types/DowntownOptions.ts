/**
 * Downtown 统一入口配置。数据库和网络地址互斥，平台数据库由宿主显式提供。
 * 当前实例只持有进程内凭证，不负责宿主的登录态持久化。
 */
import type { DowntownRuntimeOptions } from "../../downtown/types.js";
import type { FetchLike } from "../../pact/http.js";

/** 连接实例在宿主目录中的稳定本地身份。 */
export interface DowntownIdentity {
  /** 稳定本地条目 ID；省略时远端使用规范 URL，本地使用 local。 */
  id?: string;
  /** 可改变的用户可见名称，不参与实例身份。 */
  name?: string;
}

/** 用户与管理员保持独立的访问身份。 */
export interface DowntownCredentials {
  /** 独立提供用户认证的动态读取器，无需初始 user_token；请求前通过原始 fetch 读取凭证，空值或异常阻止发送。 */
  resolve_user_token?: (fetcher: FetchLike) => Promise<string>;
  /** 静态用户 Token；与动态读取器都省略时以 guest 进入标准鉴权流程，配置读取器后优先使用动态凭证。 */
  user_token?: string;
  /** 管理员 Session Token；不会从普通用户 Token 推导。 */
  admin_token?: string;
}

/** 当前进程执行的 Downtown；数据库所有权交给实例并由 dispose 释放。 */
export interface LocalDowntownOptions extends DowntownRuntimeOptions, DowntownCredentials, DowntownIdentity {
  /** 本地实例禁止配置远端地址。 */
  url?: never;
  /** 本地实例禁止注入网络传输，所有业务请求直接交给内核。 */
  fetch?: never;
}

/** 使用已有远端 Downtown；不创建或迁移数据库。 */
export interface RemoteDowntownOptions extends DowntownCredentials, DowntownIdentity {
  /** 明确信任的 HTTP(S) 基础地址，可包含部署前缀路径。 */
  url: string;
  /** 远端实例不能持有本地数据库。 */
  database?: never;
  /** 自定义网络 fetch，必须支持请求取消与流式响应。 */
  fetch?: FetchLike;
}

/** Downtown 的两种互斥构造方式；不隐式选择数据库或远端目标。 */
export type DowntownOptions = LocalDowntownOptions | RemoteDowntownOptions;
