/**
 * Power 可使用的 Town 资源端口。
 * 只暴露普通模型和 Service 目录及调用，不包含连接增删、登录、凭据或管理员能力。
 */
import type { TownModels } from "@/town/TownModels.js";
import type { TownServices } from "@/town/Town.js";

/** 单次 Power 调用与后台生命周期共用的最小资源路由能力。 */
export interface PowerTown {
  /** 模型聚合、绑定恢复及 AI 调用；不允许 Power 注册、移除或关闭模型来源。 */
  readonly models: Pick<TownModels, "list" | "client" | "decision" | "image_create" | "image_result" | "tts" | "asr">;
  /** 普通 Service 目录和显式来源调用；不包含任何账户或连接管理能力。 */
  readonly services: Pick<TownServices, "list" | "describe" | "call">;
}
