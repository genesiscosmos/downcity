/**
 * 运行实例服务目录与 API 详情的只读传输契约。
 *
 * 公开投影不包含业务处理器、检查回调或环境变量值。
 */
import type { EnvRequirement, RouteAuth, ServiceRouteMethod } from "../service/service.js";
import type { ApiDocumentation, ServiceAvailability } from "./ServiceDiscovery.js";

/** API 文档的 JSON 投影，回调及别名覆盖不会出现在传输结果中。 */
export type PublicApiDocumentation = Omit<ApiDocumentation, "availability" | "aliases">;

/** 单个入口的公开摘要。 */
export interface ServiceEndpointSummary {
  /** action ID，原生路由使用 namespace 内路径。 */
  id: string;
  /** 入口种类；原生路由直接处理 HTTP Request。 */
  kind: "action" | "native";
  /** 用途摘要；未提供时为 null。 */
  description: string | null;
  /** 实际注册 HTTP 方法。 */
  method: ServiceRouteMethod;
  /** 公开路径，原生路由可能包含 wildcard。 */
  path: string;
  /** 框架允许的身份集合；空数组表示框架公开入口。 */
  auth: RouteAuth;
  /** 框架之外的原生协议鉴权由入口说明描述。 */
  protocol?: string;
  /** 实际 HTTP 别名路径，仅包含框架已注册的别名。 */
  aliases: string[];
  /** 当前本地就绪检查结果。 */
  availability: ServiceAvailability;
}

/** 单个入口的详细文档。 */
export interface ServiceEndpointDetail extends ServiceEndpointSummary {
  /** 已归一化的请求解析方式，原生入口使用 raw。 */
  body: "json" | "raw";
  /** 注册声明的公开文档，包含 schema、示例、错误与要求。 */
  documentation: PublicApiDocumentation | null;
  /** 是否提供请求 schema。 */
  request_documented: boolean;
  /** 是否提供至少一种响应 schema。 */
  response_documented: boolean;
}

/** 服务发现列表中的一项。 */
export interface ServiceCatalogSummary {
  /** 注册的服务标识。 */
  id: string;
  /** 服务展示名称。 */
  name: string;
  /** 服务用途摘要；未提供时为 null。 */
  description: string | null;
  /** 必需配置及依赖要求，不含实际配置值。 */
  requirements: string[];
  /** 声明的环境变量需求，不含实际值。 */
  env: EnvRequirement[];
  /** 服务与入口检查聚合后的当前状态。 */
  availability: ServiceAvailability;
  /** 当前注册的业务 action 摘要。 */
  actions: ServiceEndpointSummary[];
  /** 直接处理 HTTP 的原生路由摘要。 */
  routes: ServiceEndpointSummary[];
  /** 服务详情文档的相对 URL。 */
  docs_url: string;
}

/** 单个服务的完整公开文档。 */
export interface ServiceCatalogDetail extends Omit<ServiceCatalogSummary, "actions" | "routes"> {
  /** 服务长篇说明；未声明或解析失败时为 null。 */
  instruction: string | null;
  /** instruction 是否由作者提供并成功解析。 */
  instruction_documented: boolean;
  /** action 的参数、响应、错误和示例。 */
  actions: ServiceEndpointDetail[];
  /** 原生路由的协议文档。 */
  routes: ServiceEndpointDetail[];
}
