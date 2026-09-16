/**
 * City Capability 运行时。
 *
 * 关键点（中文）
 * - 持有 City 全部 capability，并把它们投影为模型侧的两件东西：一等工具与 system 说明。
 * - 工具名在 City 内必须唯一，重复属于装配不变量，立即失败。
 * - Capability 没有生命周期：它们不持有连接或后台资源，因此不需要 initialize/dispose。
 * - 上下文由 City 在调用时即时投影，运行时只负责把它交给具体 capability。
 */

import {
  define_runtime_tool,
  type RuntimeTool,
  type RuntimeToolExecutionOptions,
} from "@downcity/type";
import type { SessionSystemBlock } from "@downcity/type";
import type {
  CityCapability,
  CityCapabilityContext,
} from "@/capabilities/types/CityCapability.js";

/** 按 capability 标识与单次执行选项投影执行上下文。 */
export type CityCapabilityToolContextFactory = (
  capability_id: string,
  execution_options: RuntimeToolExecutionOptions,
) => CityCapabilityContext;

/** 按 capability 标识投影执行上下文。 */
export type CityCapabilityContextFactory = (
  capability_id: string,
) => CityCapabilityContext;

/** City 全部 capability 的统一运行时。 */
export class CityCapabilityRuntime {
  /** 已登记的 capability，按登记顺序。 */
  private readonly capabilities: readonly CityCapability[];

  constructor(capabilities: readonly CityCapability[]) {
    const tool_names = new Set<string>();
    for (const capability of capabilities) {
      for (const tool of capability.tools) {
        const tool_name = String(tool.name || "").trim();
        if (!tool_name) {
          throw new Error(`City capability "${capability.id}" exposes a tool without a name`);
        }
        if (tool_names.has(tool_name)) {
          throw new Error(`City capability tool name conflict: ${tool_name}`);
        }
        tool_names.add(tool_name);
      }
    }
    this.capabilities = capabilities;
  }

  /** 返回当前检查点可见的 capability 工具。 */
  tools(create_context: CityCapabilityToolContextFactory): Record<string, RuntimeTool> {
    const tools: Record<string, RuntimeTool> = {};
    for (const capability of this.capabilities) {
      for (const tool of capability.tools) {
        tools[tool.name] = define_runtime_tool<unknown>({
          description: tool.description,
          input_schema: tool.input_schema,
          execute: async (input, execution_options) =>
            await tool.execute(input, create_context(capability.id, execution_options)),
        });
      }
    }
    return tools;
  }

  /** 返回当前检查点需要注入 session system 的 capability 说明。 */
  async system_blocks(
    create_context: CityCapabilityContextFactory,
  ): Promise<SessionSystemBlock[]> {
    const blocks: SessionSystemBlock[] = [];
    for (const capability of this.capabilities) {
      if (!capability.system) continue;
      const content = String(
        await capability.system(create_context(capability.id)) ?? "",
      ).trim();
      if (!content) continue;
      blocks.push({ source: "plugin", name: capability.id, content });
    }
    return blocks;
  }

  /**
   * 调用某个 capability 的程序化动作。
   *
   * 关键点（中文）
   * - 这是给插件与宿主用的入口，不进入模型工具清单。
   * - capability 未声明 `invoke` 或未声明该动作时都直接失败，不做静默降级。
   */
  async invoke(input: {
    /** 目标 capability 标识。 */
    capability_id: string;
    /** 目标动作名。 */
    action: string;
    /** 动作输入。 */
    payload: unknown;
    /** 按 capability 标识投影执行上下文。 */
    create_context: CityCapabilityContextFactory;
  }): Promise<unknown> {
    const capability = this.capabilities.find((item) => item.id === input.capability_id);
    if (!capability) {
      throw new Error(`City capability not found: ${input.capability_id}`);
    }
    if (!capability.invoke) {
      throw new Error(`City capability has no programmatic actions: ${input.capability_id}`);
    }
    return await capability.invoke(
      input.action,
      input.payload,
      input.create_context(input.capability_id),
    );
  }

  /** 当前已登记的 capability 是否包含指定标识。 */
  has(capability_id: string): boolean {
    return this.capabilities.some((item) => item.id === capability_id);
  }
}
