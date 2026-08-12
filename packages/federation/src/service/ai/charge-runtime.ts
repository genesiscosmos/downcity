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
 * - 客户端取消时同步取消上游，并消费扣费 Promise，避免未处理 rejection。
 */
export async function settle_response_charge(
  response: Response,
  charge_promise: Promise<void>,
): Promise<Response> {
  if (!response.body) {
    await charge_promise;
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (!chunk.done) {
          controller.enqueue(chunk.value);
          return;
        }
        await charge_promise;
        controller.close();
      } catch (error) {
        void charge_promise.catch(() => undefined);
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        await charge_promise;
      }
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
