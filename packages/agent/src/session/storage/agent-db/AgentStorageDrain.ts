/**
 * 存储租约的有界资源释放等待。
 *
 * 等待超时只表示释放尚未完成，不表示任何事务回滚。底层释放继续持有资源并结算
 * 已接受请求；重入释放得到同一结果，宿主通过 operation receipt 核对未知提交。
 */

/** 为已开始的释放操作设置等待预算，不取消其内部持有的真实资源。 */
export async function wait_agent_storage_drain(operation: Promise<void>, timeout_ms = 30_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("session_storage_drain_timeout: accepted operations may still commit")), timeout_ms);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
