/** Plugin Action 的统一公开协议与 Agent transport 调用端口。 */

import type { PluginJsonValue } from "@/plugin/index.js";

export type {
  PluginAction,
  PluginActionApi,
  PluginActionCommand,
  PluginActionCommandInput,
  PluginActionExample,
  PluginActionInputSchema,
  PluginActionResult,
  PluginActions,
} from "@/plugin/index.js";

/** Action 元数据是不含执行器和 transport 适配的公开描述。 */
export type PluginActionMetadata<P extends PluginJsonValue = PluginJsonValue> = Pick<
  import("@/plugin/index.js").PluginAction<P>,
  "description" | "input_schema" | "examples" | "timeout_ms"
>;

/** Plugin Action 调用参数。 */
export interface PluginActionInvokeParams {
  /** 目标 Plugin ID。 */
  plugin: string;
  /** 目标 Action ID。 */
  action: string;
  /** 可选 JSON payload。 */
  payload?: PluginJsonValue;
}

/** Plugin Action 调用结果。 */
export interface PluginActionInvokeResult {
  /** Action 是否成功。 */
  success: boolean;
  /** 可选 JSON 数据。 */
  data?: PluginJsonValue;
  /** 可选错误文本。 */
  error?: string;
}

/** Transport 使用的 Plugin Action 调用端口。 */
export interface PluginActionInvokePort {
  /** 调用指定 Plugin Action。 */
  invoke(params: PluginActionInvokeParams): Promise<PluginActionInvokeResult>;
}
