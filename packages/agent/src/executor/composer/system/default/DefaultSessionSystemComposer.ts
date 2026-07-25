/**
 * DefaultSessionSystemComposer：默认 system Composer。
 *
 * 关键点（中文）
 * - 该实现归属默认 system Composer，统一负责 Session system 解析入口。
 * - 具体“解析 / 加载 / 组装”下沉到 SystemDomain，保持类本身轻量。
 */

import type {
  SessionSystemComposer,
} from "@executor/composer/system/SessionSystemComposer.js";
import type { PluginContext } from "@/types/plugin/PluginContext.js";
import type { SessionRunContext } from "@/types/executor/SessionRunContext.js";
import {
  resolve_session_system_messages,
  type SystemProfile,
} from "@executor/composer/system/default/SystemDomain.js";

type DefaultSessionSystemComposerOptions = {
  /**
   * 项目根目录，用于渲染运行时 system 模板。
   */
  project_root: string;

  /**
   * 读取当前生效的静态 system 文本集合。
   */
  get_static_system_prompts: () => string[];

  /**
   * 读取当前执行上下文（用于加载 plugin system 文本）。
   */
  get_context: () => PluginContext;

  /**
   * system 档位（默认 chat）。
   */
  profile?: SystemProfile;
};

/**
 * SessionSystemComposer 默认实现。
 */
export class DefaultSessionSystemComposer implements SessionSystemComposer {
  readonly name = "prompt_system";

  private readonly project_root: string;
  private readonly get_static_system_prompts: DefaultSessionSystemComposerOptions["get_static_system_prompts"];
  private readonly get_context: DefaultSessionSystemComposerOptions["get_context"];
  private readonly profile: SystemProfile;

  constructor(options: DefaultSessionSystemComposerOptions) {
    const project_root = String(options.project_root || "").trim();
    if (!project_root) {
      throw new Error("DefaultSessionSystemComposer requires a non-empty project_root");
    }
    this.project_root = project_root;
    this.get_static_system_prompts = options.get_static_system_prompts;
    this.get_context = options.get_context;
    this.profile = options.profile === "task" ? "task" : "chat";
  }

  async resolve(run_context: SessionRunContext) {
    const session_id = String(run_context.session_id || "").trim();
    if (!session_id) {
      throw new Error("DefaultSessionSystemComposer.resolve requires a non-empty session_id");
    }
    return await resolve_session_system_messages({
      project_root: this.project_root,
      session_id,
      profile: this.profile,
      static_system_prompts: this.get_static_system_prompts(),
      context: this.get_context(),
    });
  }
}
