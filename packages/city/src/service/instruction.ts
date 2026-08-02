/**
 * 模块说明文档协议。
 *
 * 负责定义 City / Service / InstallableService 可共享的 instruction 能力，
 * 以及 Federation 聚合输出时使用的格式化工具。
 */

import type { Context, EnvRequirement, RouteAuth } from "./service.js";

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
  lines.push("Federation 是 Downcity 的服务端基础设施运行容器，负责挂载 Service、初始化内置 env/bureaus 能力、统一处理 /v1/* HTTP 路由，以及校验 user_token 与 bureau_token。");
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

    if (section.env && section.env.length > 0) {
      lines.push("环境变量：");
      for (const item of section.env) {
        lines.push(`- ${item.key} | ${item.required ? "required" : "optional"} | ${item.description}`);
      }
    }

    if (section.actions.length > 0) {
      lines.push("动作与路由：");
      for (const action of section.actions) {
        lines.push(`- ${action.method} /v1/${section.id}/${action.id} | auth: ${formatRouteAuth(action.auth)}`);
      }
    }

    if (section.body) {
      lines.push("说明：");
      lines.push(section.body);
    }
  }

  return lines.join("\n").trim();
}
