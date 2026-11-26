/** Memory Job 的非秘密模型身份；提交时捕获，跨重试保持不变。 */
import type { ModelReference } from "@downcity/type";

/** 可以安全保存到 Job 的精确模型来源。 */
export interface MemoryModelBinding {
  /** 选定的精确模型 ID。 */
  model: ModelReference;
  /** 宿主已确认且支持持久恢复的不透明授权来源。 */
  binding_id: string;
}

/** 可信宿主读取已选执行 Agent 的模型定义，不选择模型，也不执行模型请求。 */
export type MemoryModelResolver = (
  /** 已登记执行 Agent；只读取其当前配置。 */
  agent_id: string,
) => Promise<MemoryModelBinding | undefined>;
