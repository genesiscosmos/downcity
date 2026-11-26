/** 冻结的 v13 schema、codec 与门禁，仅供显式离线转换。 */
import { load_runtime as load_protocol } from "./session-runtime.mjs";

/** 历史数据库始终使用冻结协议，不借用当前构建产物解释。 */
export async function load_runtime() {
  return load_protocol(true, "historical-v13");
}
