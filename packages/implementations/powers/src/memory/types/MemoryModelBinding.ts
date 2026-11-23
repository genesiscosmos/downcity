/** Memory Job 的非秘密模型身份；提交时捕获，跨重试保持不变。 */
import type { MemoryAccessContext } from "./MemoryAccess.js";

/** 可以安全保存到 Job 的精确模型来源。 */
export interface MemoryModelBinding {
  /** 选定的精确模型 ID。 */
  model_id: string;
  /** 宿主已确认且支持持久恢复的不透明授权来源。 */
  binding_id: string;
}

/** 可信宿主按 Job 所属 Agent/Workspace 读取默认或已配置模型，不执行模型请求。 */
export type MemoryModelResolver = (
  /** Job 的固定执行范围。 */
  access: MemoryAccessContext,
  /** 配置指定的模型；缺省时读取所属 Agent 默认模型。 */
  model_id?: string,
) => Promise<MemoryModelBinding | undefined>;
