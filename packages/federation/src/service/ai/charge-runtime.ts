/**
 * AI 延迟扣费响应生命周期模块。
 *
 * 负责在没有 Worker ExecutionContext 的运行时中，把异步扣费绑定到 HTTP
 * Response 的流结束阶段，避免请求已经结束但余额结算仍处于游离状态。
 */

/**
 * 将 Node 环境中的延迟扣费绑定到响应流生命周期。
 *
 * 关键说明（中文）
 * - 不能在返回 Response 前直接等待，因为账单可能依赖流消费完成，会形成死锁。
 * - 上游流结束后先等待扣费，再关闭下游流，确保请求生命周期覆盖结算。
 * - 立即监听扣费失败，避免消费响应前出现未处理 rejection。
 * - 客户端取消时发起上游取消并释放 reader；只等待扣费，不等待上游 cancel。
 */
export async function settle_response_charge(
  response: Response,
  charge_promise: Promise<void>,
): Promise<Response> {
  // 扣费可能早于首次 pull 失败；保留原 Promise 的失败语义，同时及时消费 rejection。
  void charge_promise.catch(() => undefined);
  if (!response.body) {
    await charge_promise;
    return response;
  }

  const reader = response.body.getReader();
  /** 下游取消后，正在读取或等待扣费的 pull 不再操作 controller。 */
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      /** 完成或异常后释放 reader；正常分块消费期间保持锁定。 */
      let release_reader = false;
      try {
        const chunk = await reader.read();
        if (cancelled) return;
        if (!chunk.done) {
          controller.enqueue(chunk.value);
          return;
        }
        release_reader = true;
        reader.releaseLock();
        await charge_promise;
        if (!cancelled) controller.close();
      } catch (error) {
        release_reader = true;
        if (!cancelled) controller.error(error);
      } finally {
        if (release_reader || cancelled) reader.releaseLock();
      }
    },
    async cancel(reason) {
      cancelled = true;
      try {
        // 上游 cancel 可能等待 provider 或结算，不能让它阻塞扣费生命周期。
        void reader.cancel(reason).catch(() => undefined);
      } finally {
        reader.releaseLock();
      }
      await charge_promise;
    },
  }, { highWaterMark: 0 });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
