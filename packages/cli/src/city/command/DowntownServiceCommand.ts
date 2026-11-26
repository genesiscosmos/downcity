/**
 * Town 服务访问命令。显式连接和固定 owner 覆盖整个响应消费生命周期；
 * JSON/raw/SSE/binary 正文逐字节写出，不序列化 Response，不重试 Action。
 */
import { randomUUID } from "node:crypto";
import { readFile, writeFile, open } from "node:fs/promises";
import { once } from "node:events";
import type { Command } from "commander";
import { ResourceError, type TownResponseOpen, type TownResponseChunk } from "@downcity/city/local";
import type { ServiceCatalogDetail } from "@downcity/downtown";
import { with_cli_town } from "../resources/TownClient.js";
import { format_downtown_service } from "../shared/DowntownAccessOutput.js";

import { create_downtown_id } from "@downcity/city";
import type { ServiceOptions } from "../types/DowntownCommand.js";

/** 将服务访问加入 city towns 命令组，复用连接管理。 */
export function register_downtown_service_commands(downtown: Command): void {
  const options = (command: Command) => command.requiredOption("--downtown <url>", "Registered Downtown URL")
    .option("--root <path>", "City data root").option("--json", "Complete discovery JSON; call bodies remain exact bytes");
  options(downtown.command("service <service_id>").description("Read public service documentation from one connection"))
    .action((service_id: string, opts: ServiceOptions) => run(opts, async (signal) => {
      await with_cli_town(opts.root, async (call) => {
        const result = await call("town.service", { downtown_id: create_downtown_id(opts.downtown), service_id }, signal) as { /** 远端注册的完整服务说明。 */ detail: ServiceCatalogDetail };
        process.stdout.write(opts.json ? JSON.stringify(result, null, 2) + "\n" : format_downtown_service(result.detail));
      });
    }));
  options(downtown.command("openapi").description("Read or export the selected connection's public OpenAPI"))
    .option("--output <file>", "Write the OpenAPI JSON document to a file")
    .action((opts: ServiceOptions) => run(opts, async (signal) => {
      await with_cli_town(opts.root, async (call) => {
        const document = await call("town.openapi", { downtown_id: create_downtown_id(opts.downtown) }, signal);
        const text = JSON.stringify(document, null, 2) + "\n";
        if (opts.output) await writeFile(opts.output, text, { signal });
        else process.stdout.write(text);
      });
    }));
  options(downtown.command("call <service_id> <action_id>").description("Call the registered Action with its declared HTTP method and body format"))
    .option("--input <file>", "JSON object or raw text according to the Action; - reads stdin (max 8 MiB)")
    .option("--output <file>", "Write exact response bytes to a file (including binary)")
    .option("--admin", "Administrator access is not supported by this user-scoped Town bridge")
    .action((service_id: string, action_id: string, opts: ServiceOptions) => run(opts, async (signal) => {
      if (opts.admin) throw new ResourceError("admin_not_supported", "Town service calls currently support user/guest access only; --admin requires a separate administrator bridge", 2);
      const raw_input = await read_input(opts.input, signal);
      if (raw_input && Buffer.byteLength(JSON.stringify(raw_input)) > 12 * 1024 * 1024) throw new ResourceError("validation_error", "Encoded service input exceeds the management frame limit", 2);
      await with_cli_town(opts.root, async (call) => {
        const request_id = randomUUID();
        let response: TownResponseOpen | undefined;
        let completed = false;
        const file = opts.output ? await open(opts.output, "w") : undefined;
        try {
          response = await call("town.call.open", { request_id, downtown_id: create_downtown_id(opts.downtown), service_id, action_id, raw_input }, signal) as TownResponseOpen;
          while (true) {
            signal.throwIfAborted();
            const chunk = await call("town.call.next", { request_id, handle: response.handle, downtown_id: create_downtown_id(opts.downtown) }, signal) as TownResponseChunk;
            if (chunk.done) { completed = true; break; }
            if (chunk.data !== undefined) {
              const bytes = Buffer.from(chunk.data, "base64");
              if (bytes.byteLength > 64 * 1024) throw new ResourceError("invalid_response", "Owner returned an oversized response chunk", 5);
              if (file) {
                let offset = 0;
                while (offset < bytes.length) { signal.throwIfAborted(); offset += (await file.write(bytes, offset, bytes.length - offset)).bytesWritten; }
              } else if (!process.stdout.write(bytes)) await once(process.stdout, "drain", { signal });
            }
          }
          if (response.status < 200 || response.status >= 300) throw new ResourceError("downtown_http_error", `Downtown request failed (HTTP ${response.status})`, 1, false, { status: response.status });
        } finally {
          // 即使 open 的响应在断开后迟到，也用最初 request_id 取消，不猜测句柄或重放请求。
          if (!completed) await call("town.call.cancel", { request_id, handle: response?.handle, downtown_id: create_downtown_id(opts.downtown) }).catch(() => {});
          await file?.close();
        }
      });
    }));
}

/** 输入不加载超过有界管理帧的内容；raw 不 trim，不进行 JSON 重编码。 */
async function read_input(file_path: string | undefined, signal: AbortSignal): Promise<string | undefined> {
  if (!file_path) return undefined;
  const limit = 8 * 1024 * 1024;
  if (file_path !== "-") {
    const file = await open(file_path, "r");
    try {
      if ((await file.stat()).size > limit) throw new ResourceError("validation_error", "Service input exceeds 8 MiB", 2);
      const bytes = await readFile(file, { signal });
      if (bytes.length > limit) throw new ResourceError("validation_error", "Service input exceeds 8 MiB", 2);
      return bytes.toString("utf8");
    } finally { await file.close(); }
  }
  const chunks: Buffer[] = [];
  let size = 0;
  const cancel = () => process.stdin.destroy(new Error("Input cancelled"));
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for await (const chunk of process.stdin) {
      signal.throwIfAborted();
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > limit) throw new ResourceError("validation_error", "Service input exceeds 8 MiB", 2);
      chunks.push(bytes);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { signal.removeEventListener("abort", cancel); }
}

/** 控制台诊断只写 stderr，不污染正文；取消或下游关闭都会经 finally 归还响应租约。 */
async function run(options: ServiceOptions, operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Service call cancelled"));
  const output_error = (error: Error) => controller.abort(error);
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  process.stdout.on("error", output_error);
  try { await operation(controller.signal); }
  catch (error) {
    process.exitCode = controller.signal.aborted ? 130 : 1;
    const message = controller.signal.aborted ? "Service call cancelled" : error instanceof ResourceError ? error.message : "Downtown service command failed";
    const status = error instanceof ResourceError && typeof error.details.status === "number" ? error.details.status : undefined;
    process.stderr.write(options.json ? JSON.stringify({ success: false, error: { message, ...(status ? { status } : {}) } }) + "\n" : message + "\n");
  } finally {
    process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel);
    process.stdout.removeListener("error", output_error);
  }
}
