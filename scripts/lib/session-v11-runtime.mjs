/** 冻结 v11 的 schema、codec 与门禁，只供显式历史迁移使用，不启动任何宿主。 */
import { load_runtime as load_protocol } from "./session-runtime.mjs";

/** 历史格式只由冻结协议解释，不能将当前构建产物误当作源格式。 */
export async function load_runtime() {
  return load_protocol(true, "historical-v11");
}
