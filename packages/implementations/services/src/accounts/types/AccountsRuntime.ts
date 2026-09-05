/**
 * Accounts 登录运行时内部类型。
 *
 * 类型用于装配 AccountsService、登录运行时与路由，不构成 package 对外 API。
 */

import type { ServiceDatabaseContext, ServiceInstallContext } from "@downcity/federation";
import type { AccountsProvider, AccountsServiceOptions } from "../types.js";

/** Accounts 登录运行时构造参数。 */
export interface AccountsRuntimeOptions {
  /** AccountsService 的用户配置。 */
  service_options: AccountsServiceOptions;
  /** 已归一化的登录 Provider。 */
  providers: AccountsProvider[];
  /** 当前 Service 可访问的受限数据库。 */
  database: ServiceDatabaseContext;
  /** 当前 AccountsService 的安装上下文，用于路由注册和 Token 签发。 */
  install_context: ServiceInstallContext;
  /** 读取 Federation 运行时环境变量。 */
  read_env: (key: string) => string | undefined;
  /** 读取 Federation 对外基础 URL。 */
  read_base_url: () => string | undefined;
  /** 校验 Bureau 当前存在且处于 active 状态。 */
  require_active_bureau: (bureau_id: string) => Promise<void>;
}

/** Accounts 路由统一返回值。 */
export interface AccountsRouteResult {
  /** 返回给调用方的 JSON 数据。 */
  body: unknown;
  /** 可选 HTTP 状态码；缺失时使用 200。 */
  status?: number;
}
