/** 宿主模型恢复协议；Agent 仅传递不透明来源，不依赖账户或 Downtown 类型。 */
import type { ModelReference, ModelClient, WorkspaceRuntime } from "@downcity/type";

/** 按精确模型和已确认来源恢复；不得将缺失来源补成当前账户。 */
export type SessionModelResolver = (
  /** 已保存的 Downtown 与原始模型 ID，不得替换为宿主默认模型。 */
  model: ModelReference,
  /** 执行所属 Workspace；由宿主恢复环境。 */
  workspace?: WorkspaceRuntime,
) => Promise<ModelClient>;
