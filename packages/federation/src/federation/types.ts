/**
 * Federation 配置类型模块。
 *
 * 包含创建 Federation 实例和健康检查所需的类型定义。
 */

import type { Database } from "../database/Database.js";
import type { FederationStorage } from "./storage.js";
import type { RuntimeUser } from "./auth/types.js";
import type { BureauRecord, RuntimeBureauToken } from "../types/Bureau.js";

/**
 * Federation 进程内可信身份。
 *
 * 关键点（中文）
 * - 只允许同进程调用 `Federation.fetch()` 时传入。
 * - 不能通过 HTTP header、query 或 body 构造，避免绕过公网 token 鉴权。
 */
export type FederationTrustedIdentity =
  | {
      /** 以管理端身份访问当前 Federation。 */
      level: "admin";
    }
  | {
      /** 以终端用户身份访问当前 Federation。 */
      level: "user";
      /** 当前用户信息，会注入到 `ctx.user`。 */
      user: RuntimeUser;
      /** 当前用户所属 Bureau。 */
      bureau: BureauRecord;
    }
  | {
      /** 以可信 Bureau 机器身份访问当前 Federation。 */
      level: "bureau";
      /** 当前机器身份所属 Bureau。 */
      bureau: BureauRecord;
      /** 当前机器凭证元数据。 */
      bureau_token: RuntimeBureauToken;
    };

/**
 * Federation 请求进入运行时的 transport 来源。
 */
export type FederationRequestTransport = "http";

/**
 * 单次请求的运行时执行上下文。
 */
export interface FederationRequestExecutionContext {
  /**
   * 延长后台任务生命周期。
   *
   * Worker 运行时会映射到 ExecutionContext.waitUntil。
   */
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Federation.fetch 的可选参数。
 */
export interface FederationFetchOptions {
  /** 单次请求的运行时执行上下文。 */
  execution?: FederationRequestExecutionContext;
  /**
   * 进程内可信身份。
   *
   * 关键点（中文）
   * - 供同进程嵌入式 server 调用使用。
   * - HTTP 入口不会从请求内容自动生成该身份。
   */
  trusted_identity?: FederationTrustedIdentity;
  /**
  /** 当前请求来源 transport，默认是 `http`。 */
  transport?: FederationRequestTransport;
}

/**
 * Federation 健康检查结果。
 */
export interface FederationHealthStatus {
  /** 当前 Runtime 是否已经完成初始化并可处理请求 */
  ok: boolean;
  /** 服务名称，用于外部探测确认命中的服务类型 */
  name: string;
  /** 健康检查响应时间 */
  checked_at: string;
  /** 当前注册的 service ID 列表 */
  services: string[];
  /** 当前启用的 service 信息列表 */
  service_list: { id: string; name: string }[];
  /**
   * 异步调度能力是否可用。
   *
   * 说明（中文）
   * - `true` 表示宿主已显式注册队列 adapter，图像生成、结算重试等异步任务可以入队。
   * - `false` 表示未注册队列，调用方应在启动期就感知，而不是等到第一次入队失败。
   */
  queue: boolean;
}

/** 单个启动阶段的性能事件。 */
export interface FederationStartupTiming {
  /** 阶段名称，Service 初始化使用 service:<id>。 */
  phase: string;
  /** 该阶段消耗的墙钟时间，单位毫秒。 */
  duration_ms: number;
  /** 该阶段是否成功完成。 */
  ok: boolean;
}

/** 创建 Federation 实例的配置；连接、事务及释放由唯一的 Database Adapter 负责。 */
export interface FederationOptions {
  /** Federation 唯一主数据库 Adapter。 */
  database: Database;
  /** 自动准备适合本地开发；prepared 要求部署阶段先调用 prepare_database()。 */
  database_initialization?: "automatic" | "prepared";
  /** 启动阶段观测回调；仅包含阶段、耗时和成功状态，不含业务数据。 */
  on_startup_timing?: (event: FederationStartupTiming) => void;
  /**
   * Federation 默认存储后端。
   *
   * 关键说明（中文）
   * - 可直接通过构造函数传入，也可在创建后调用 `federation.storage(...)` 注册。
   * - Service 通过 `ctx.storage` 使用该能力，避免业务模块绑定具体云厂商。
   */
  storage?: FederationStorage;
}
