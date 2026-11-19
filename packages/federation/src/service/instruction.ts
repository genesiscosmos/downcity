/**
 * 模块说明文档协议。
 *
 * 负责定义 City / Service / InstallableService 可共享的 instruction 能力，
 * 以及 Federation 聚合输出时使用的格式化工具。
 */

import type { EnvRequirement, RouteAuth, ServiceRouteMethod } from "./service.js";
import type { ApiDocumentation } from "../types/ServiceDiscovery.js";

/**
 * 模块说明生成时可访问的只读上下文。
 */
export interface InstructionContext {
  /**
   * 当前模块 ID。
   */
  id: string;

  /**
   * 当前模块展示名。
   */
  name: string;

  /**
   * 当前模块声明的环境变量要求。
   */
  env?: EnvRequirement[];

  /**
   * 当前模块暴露的动作列表。
   */
  actions: InstructionActionDefinition[];
}

/**
 * Federation 聚合时看到的动作定义。
 */
export interface InstructionActionDefinition {
  /**
   * Action ID。
   */
  id: string;

  /**
   * HTTP 方法。
   */
  method: "GET" | "POST";

  /**
   * 鉴权要求。
   */
  auth: RouteAuth;
  /** 入口的注册文档，格式化时不会执行 availability。 */
  documentation?: ApiDocumentation;
  /** Action POST 的正文解释方式，GET 始终使用 query。 */
  body?: "json" | "raw";
}

/** instruction 中的原生路由定义。 */
export interface InstructionNativeRouteDefinition {
  /** 原生路由接受的方法；ALL 表示所有方法。 */
  method: ServiceRouteMethod;
  /** 服务 namespace 内的原始路径，可含 wildcard。 */
  path: string;
  /** 路由访问身份要求。 */
  auth: RouteAuth;
  /** 由注册元数据提供的 API 文档。 */
  documentation?: ApiDocumentation;
}

/**
 * 模块可以提供的说明文档能力。
 */
export type InstructionDefinition =
  | string
  | ((ctx: InstructionContext) => string | Promise<string>);

/**
 * 可选实现 instruction 的模块接口。
 */
export interface InstructionCapable {
  /**
   * 当前模块的说明文档。
   */
  instruction?: InstructionDefinition;
}

/**
 * City 聚合输出的模块说明条目。
 */
export interface InstructionSection {
  /**
   * 模块 ID。
   */
  id: string;

  /**
   * 模块展示名。
   */
  name: string;

  /**
   * 模块分类。
   */
  kind: "service";

  /**
   * 动作定义。
   */
  actions: InstructionActionDefinition[];

  /**
   * 环境变量要求。
   */
  env?: EnvRequirement[];

  /**
   * 模块补充说明正文。
   */
  body?: string;
  /** 原生 HTTP route 的注册文档。 */
  native_routes?: InstructionNativeRouteDefinition[];
  /** 服务用途摘要。 */
  description?: string;
  /** 可公开的服务依赖要求。 */
  requirements?: string[];
}

/**
 * 解析模块 instruction。
 */
export async function resolveInstruction(
  instruction: InstructionDefinition | undefined,
  ctx: InstructionContext,
): Promise<string | undefined> {
  if (!instruction) return undefined;
  const content = typeof instruction === "function"
    ? await instruction(ctx)
    : instruction;
  const normalized = String(content ?? "").trim();
  return normalized || undefined;
}

/**
 * 将动作鉴权配置格式化为可读文本。
 */
export function formatRouteAuth(auth: RouteAuth): string {
  if (auth.length === 0) return "guest | user | admin";
  const levels = new Set<string>(auth);
  levels.add("admin");
  return [...levels].join(" | ");
}

/**
 * 将模块说明聚合成纯文本。
 */
export function formatInstructionDocument(input: {
  base: {
    builtin_services: string[];
    loaded_modules: string[];
  };
  sections: InstructionSection[];
}): string {
  const lines: string[] = [];

  lines.push("# Downcity Federation Instruction");
  lines.push("");
  lines.push("## Federation");
  lines.push("Federation 是 Downcity 的服务端基础设施运行容器，负责挂载显式注册的 Service、统一处理 /v1/* HTTP 路由，以及校验用户 Token 与独立管理员会话。");
  lines.push("");
  lines.push("基础使用：");
  lines.push("1. 创建 Federation 实例。");
  lines.push("2. 通过 base.use(...) 注册业务 Service、AIService 或带 install(ctx) 生命周期的服务。");
  lines.push("3. 先调用 await base.health() 完成初始化。");
  lines.push("4. 通过 base.fetch 或 base.fetch(...) 对外提供请求处理。");
  lines.push("");
  lines.push(`内置服务：${input.base.builtin_services.join(", ")}`);
  lines.push(`当前已加载模块：${input.base.loaded_modules.join(", ")}`);

  for (const section of input.sections) {
    lines.push("");
    lines.push(`## ${section.name} (${section.id})`);
    lines.push(`类型：${section.kind}`);
    if (section.description) lines.push(section.description);
    if (section.requirements?.length) lines.push(`依赖要求：${section.requirements.join("；")}`);

    if (section.env && section.env.length > 0) {
      lines.push("环境变量：");
      for (const item of section.env) {
        lines.push(`- ${item.key} | ${item.required ? "required" : "optional"} | ${item.description}`);
      }
    }

    if (section.actions.length > 0) {
      lines.push("动作与路由：");
      for (const action of section.actions) {
        lines.push(`- ${action.method} /v1/${encodeURIComponent(section.id)}/${action.id} | auth: ${formatRouteAuth(action.auth)}`);
        lines.push(`  输入：${action.method === "GET" ? "query（值为字符串）" : action.body ?? "json"}`);
        append_api_documentation(lines, action.documentation);
        for (const [path, documentation] of Object.entries(action.documentation?.aliases ?? {})) {
          lines.push(`  别名：${action.method} ${path}`);
          append_api_documentation(lines, documentation);
        }
      }
    }

    for (const route of section.native_routes ?? []) {
      lines.push(`- ${route.method} /v1/${encodeURIComponent(section.id)}${route.path} | auth: ${formatRouteAuth(route.auth)}`);
      lines.push("  输入：原生 Request；ALL 匹配所有方法，wildcard 保留路径匹配语义。");
      append_api_documentation(lines, route.documentation);
    }

    if (section.body) {
      lines.push("说明：");
      lines.push(section.body);
    }
  }

  return lines.join("\n").trim();
}

/** 将静态注册文档写入 instruction；不序列化运行回调或读取配置值。 */
function append_api_documentation(lines: string[], documentation?: ApiDocumentation): void {
  if (documentation?.description) lines.push(`  ${documentation.description}`);
  if (documentation?.protocol) lines.push(`  协议：${documentation.protocol}`);
  const request_schema = documentation?.request_schema;
  lines.push(`  请求 schema：${request_schema && Object.keys(request_schema).length ? JSON.stringify(request_schema) : "unknown（尚未描述）"}`);
  if (documentation?.request_content_type) lines.push(`  请求媒体类型：${documentation.request_content_type}`);
  const response_content = documentation?.response_content;
  if (response_content && Object.keys(response_content).length) {
    for (const [content_type, schema] of Object.entries(response_content)) {
      lines.push(`  响应 ${documentation?.response_status ?? 200} ${content_type} schema：${Object.keys(schema).length ? JSON.stringify(schema) : "unknown（尚未描述）"}`);
    }
  } else {
    const response_schema = documentation?.response_schema;
    lines.push(`  响应 ${documentation?.response_status ?? 200}${documentation?.response_content_type ? ` ${documentation.response_content_type}` : ""} schema：${response_schema && Object.keys(response_schema).length ? JSON.stringify(response_schema) : "unknown（尚未描述）"}`);
  }
  for (const requirement of documentation?.requirements ?? []) lines.push(`  要求：${requirement}`);
  for (const error of documentation?.errors ?? []) lines.push(`  错误 ${error.status}：${error.description}`);
  for (const example of documentation?.examples ?? []) {
    lines.push(`  示例：${example.name}`);
    if (example.request !== undefined) lines.push(`    请求：${JSON.stringify(example.request)}`);
    if (example.response !== undefined) lines.push(`    响应：${JSON.stringify(example.response)}`);
  }
}
