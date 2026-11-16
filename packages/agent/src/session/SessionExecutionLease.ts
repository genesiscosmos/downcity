/** 宿主执行租约在首个 await 前取得，并绑定完整 Turn 结算，不影响历史读取。 */
import type { AgentSessionTurnHandle } from "../types/sdk/AgentSessionTurn.js";

/** 恢复的 Turn 同样经过执行租约，覆盖子工作等待与最终完成写入。 */
export async function run_with_execution_lease<T>(acquire: (() => () => void) | undefined, execute: () => Promise<T>): Promise<T> {
  const release = acquire?.() ?? (() => {});
  try { return await execute(); } finally { release(); }
}

/** 提交失败立即释放；已接受输入的租约覆盖排队、模型流及 Turn 收尾。 */
export async function submit_with_execution_lease(acquire: (() => () => void) | undefined, submit: () => Promise<AgentSessionTurnHandle>): Promise<AgentSessionTurnHandle> {
  const release = acquire?.() ?? (() => {});
  try {
    const handle = await submit();
    void handle.finished.then(release, release);
    return handle;
  } catch (error) { release(); throw error; }
}
