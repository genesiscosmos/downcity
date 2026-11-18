/**
 * Federation 统一入口配置。数据库和网络地址互斥，平台数据库由宿主显式提供。
 * 当前实例只持有进程内凭证，不负责宿主的登录态持久化。
 */
import type { FederationRuntimeOptions } from "../../federation/types.js";
import type { FetchLike } from "../../pact/http.js";

/** 连接实例在宿主目录中的稳定本地身份。 */
export interface FederationIdentity {
  /** 稳定本地条目 ID；省略时远端使用规范 URL，本地使用 local。 */
  id?: string;
  /** 可改变的用户可见名称，不参与实例身份。 */
  name?: string;
}

/** 用户与管理员保持独立的访问身份。 */
export interface FederationCredentials {
  /** 每次发送用户请求前读取宿主共享凭证；传入原始 fetch 以复用代理和请求取消策略。 */
  resolve_user_token?: (fetcher: FetchLike) => Promise<string>;
  /** 当前用户 Token；省略时用户请求以 guest 进入标准鉴权流程。 */
  user_token?: string;
  /** 管理员 Session Token；不会从普通用户 Token 推导。 */
  admin_token?: string;
}

/** 当前进程执行的 Federation；数据库所有权交给实例并由 dispose 释放。 */
export interface LocalFederationOptions extends FederationRuntimeOptions, FederationCredentials, FederationIdentity {
  /** 本地实例禁止配置远端地址。 */
  url?: never;
  /** 本地实例禁止注入网络传输，所有业务请求直接交给内核。 */
  fetch?: never;
}

/** 使用已有远端 Federation；不创建或迁移数据库。 */
export interface RemoteFederationOptions extends FederationCredentials, FederationIdentity {
  /** 明确信任的 HTTP(S) 基础地址，可包含部署前缀路径。 */
  url: string;
  /** 远端实例不能持有本地数据库。 */
  database?: never;
  /** 自定义网络 fetch，必须支持请求取消与流式响应。 */
  fetch?: FetchLike;
}

/** Federation 的两种互斥构造方式；不隐式选择数据库或远端目标。 */
export type FederationOptions = LocalFederationOptions | RemoteFederationOptions;
