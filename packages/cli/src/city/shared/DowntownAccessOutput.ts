/**
 * Downtown CLI的人读文档、机器JSON及原始响应输出。
 * SSE和二进制按字节转发，保留背压；取消时释放reader，错误不把响应正文当诊断回显。
 */
import { once } from "node:events";
import type { FetchResponseLike, ServiceCatalogDetail, ServiceCatalogSummary } from "@downcity/downtown";

/** 完整JSON输出，不混入进度或状态提示。 */
export function print_downtown_json(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** 服务列表简洁展示状态及用途。 */
export function format_downtown_services(items: ServiceCatalogSummary[]): string {
  if (!items.length) return "No registered services.\n";
  return items.map(item => [
    `${item.id} (${item.name})  ${item.availability.status}`,
    item.description,
    item.availability.reason,
    `Actions: ${item.actions.map(action => `${action.id} [${action.availability.status}]`).join(", ") || "none"}`,
    `Docs: ${item.docs_url}`,
  ].filter(Boolean).join("\n")).join("\n\n") + "\n";
}

/** 完整服务说明，保留schema、协议、错误、示例及未文档化标记。 */
export function format_downtown_service(detail: ServiceCatalogDetail): string {
  const lines = [`${detail.id} (${detail.name})  ${detail.availability.status}`];
  if (detail.description) lines.push(detail.description);
  if (detail.availability.reason) lines.push(detail.availability.reason);
  if (detail.requirements.length) lines.push(`Requirements: ${detail.requirements.join("; ")}`);
  for (const item of detail.env) lines.push(`Env: ${item.key} (${item.required ? "required" : "optional"}) — ${item.description}`);
  if (detail.instruction) lines.push("", detail.instruction);
  for (const entry of [...detail.actions, ...detail.routes]) {
    lines.push("", `${entry.method} ${entry.path} [${entry.kind}, ${entry.availability.status}]`,
      `Auth: ${entry.auth.join(", ") || "public"}`, `Body: ${entry.method === "GET" ? "query" : entry.body}`);
    if (entry.availability.reason) lines.push(entry.availability.reason);
    if (entry.aliases.length) lines.push(`Aliases: ${entry.aliases.join(", ")}`);
    if (entry.documentation) {
      lines.push(JSON.stringify(entry.documentation, null, 2));
    }
    if (!entry.request_documented) lines.push("Request schema: undocumented");
    if (!entry.response_documented) lines.push("Response schema: undocumented");
  }
  return lines.join("\n") + "\n";
}

/** 转发响应并保证流被读完或取消；JSON内容先解析以提供稳定格式。 */
export async function output_downtown_response(response: FetchResponseLike, signal?: AbortSignal): Promise<void> {
  const media_type = (response.headers?.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (media_type === "application/json" || media_type.endsWith("+json")) {
    print_downtown_json(await response.json());
    return;
  }
  if (!response.body) {
    const text = await response.text();
    process.stdout.write(text);
    return;
  }
  const reader = response.body.getReader();
  let completed = false;
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    while (true) {
      const chunk = await reader.read();
      signal?.throwIfAborted();
      if (chunk.done) { completed = true; break; }
      if (!process.stdout.write(chunk.value)) await once(process.stdout, "drain", { signal });
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    if (!completed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
