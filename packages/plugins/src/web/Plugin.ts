/**
 * WebPlugin：联网方法论注入插件。
 *
 * 关键点（中文）
 * - web plugin 不选择 provider，也不持久化 provider 运行态。
 * - install action 只返回联网能力安装提示，不执行命令或修改文件。
 * - 它只通过 `system()` 注入联网研究与浏览器使用方法论。
 * - 具体执行能力由当前 agent 已注册的 tools、skills 或外部 plugin 决定。
 */

import { BasePlugin } from "@downcity/agent";
import { create_action } from "@downcity/agent";
import { z } from "zod";
import type { PluginContext } from "@downcity/agent";
import type { JsonObject, JsonValue, PluginActionResult } from "@downcity/agent";
import { WEB_PLUGIN_PROMPT } from "@/web/WebPromptAssets.js";
import { render_web_install_prompt } from "@/web/runtime/Prompt.js";
import type { WebPluginInstallPayload } from "@/web/types/WebPlugin.js";
import { WEB_PLUGIN_ACTIONS } from "@/web/types/WebPlugin.js";

/**
 * 读取字符串选项。
 */
function get_string_opt(
  opts: Record<string, JsonValue>,
  key: string,
): string | undefined {
  const value = opts[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * 读取安装目标。
 */
function get_install_target_opt(
  opts: Record<string, JsonValue>,
): "web-access" | "agent-browser" | "all" | undefined {
  const value = get_string_opt(opts, "target");
  if (value === "web-access" || value === "agent-browser" || value === "all") {
    return value;
  }
  return undefined;
}

/**
 * 读取安装作用域。
 */
function get_install_scope_opt(
  opts: Record<string, JsonValue>,
): "user" | "project" | undefined {
  const value = get_string_opt(opts, "scope");
  if (value === "user" || value === "project") return value;
  return undefined;
}

/**
 * WebPlugin：为 agent 注入联网任务的方法论。
 */
export class WebPlugin extends BasePlugin {
  /**
   * 当前 plugin 稳定名称。
   */
  readonly name = "web";

  /**
   * 插件标题。
   */
  readonly title = "Web Methodology";

  /**
   * 插件说明。
   */
  readonly description =
    "Injects web research and browser-use methodology for agents.";

  /**
   * WebPlugin 对外 action。
   */
  readonly actions = {
    [WEB_PLUGIN_ACTIONS.install]: create_action({
      description:
        "Return instructions for installing web-related Skills and CLIs. This action does not install anything.",
      input_schema: {
        zod: z.object({
          target: z.enum(["web-access", "agent-browser", "all"]).optional(),
          scope: z.enum(["user", "project"]).optional(),
        }),
        json_schema: {
          type: "object",
          properties: {
            target: {
              type: "string",
              enum: ["web-access", "agent-browser", "all"],
              description: "Web capability to receive installation instructions for.",
            },
            scope: {
              type: "string",
              enum: ["user", "project"],
              description: "Installation scope for the agent-browser CLI.",
            },
          },
        },
      },
      examples: [
        {
          title: "Get user-level installation instructions for all web capabilities",
          payload: { target: "all", scope: "user" },
        },
      ],
      command: {
        description:
          "Return web capability installation instructions without executing them.",
        configure(command) {
          command
            .option("--target <target>", "web-access、agent-browser 或 all")
            .option("--scope <scope>", "agent-browser CLI 安装位置：user 或 project");
        },
        map_input({ opts }): JsonObject {
          return {
            ...(get_install_target_opt(opts)
              ? { target: get_install_target_opt(opts) }
              : {}),
            ...(get_install_scope_opt(opts)
              ? { scope: get_install_scope_opt(opts) }
              : {}),
          } satisfies JsonObject;
        },
      },
      execute({ input }): PluginActionResult<JsonObject> {
        const result = render_web_install_prompt(
          input as WebPluginInstallPayload | undefined,
        );
        return {
          success: true,
          data: result,
          message:
            "Web capability installation instructions ready; no commands were executed and no files were changed.",
        };
      },
    }),
  };

  /**
   * 注入联网方法论提示词。
   */
  system(_context: PluginContext): string {
    return WEB_PLUGIN_PROMPT;
  }
}
