/**
 * Image capability：City 自己拥有的图片生成能力。
 *
 * 关键点（中文）
 * - 向模型暴露三个一等工具：`image_models`、`image_create`、`image_result`。
 * - 图片 AI 来自 City 持有的 Embassy；本地图片读取以当前 Workspace 为根。
 * - 成功结果中的远程图片会写入 capability 私有目录，并保留在线来源地址。
 * - 失败直接抛错，由执行器统一收敛成 tool error result。
 */

import type { ActionResult } from "@downcity/agent";
import type { PluginJsonObject, PluginJsonValue } from "@/plugin/index.js";
import type {
  CityCapability,
  CityCapabilityContext,
  CityCapabilityTool,
} from "@/capabilities/types/CityCapability.js";
import type {
  ImageAiService,
  ImageCreateInput,
  ImageJobCreateResult,
  ImageJobResult,
  ImageModel,
} from "@/capabilities/image/types/Image.js";
import {
  describe_error,
  normalize_image_models,
  normalize_image_result,
  normalize_image_result_input,
  validate_created_job,
  validate_job_result,
} from "@/capabilities/image/runtime/ImageProtocol.js";
import { normalize_image_create_input, normalize_image_payload } from "@/capabilities/image/runtime/ImageInput.js";
import { localize_image_result } from "@/capabilities/image/runtime/ImageResultStorage.js";

/** `image_result` 阻塞等待时的默认与上限参数。 */
const DEFAULT_WAIT_MS = 60_000;
const DEFAULT_POLL_MS = 1_500;
const MAX_WAIT_MS = 10 * 60_000;

/** 从 City 注入的 Embassy 获取图片 AI 服务。 */
function require_image_ai(context: CityCapabilityContext): ImageAiService {
  const service = context.embassy?.user.ai;
  if (!service) throw new Error("image capability requires a City Embassy user AI service");
  return {
    catalog: async () => await service.catalog(),
    image_create: async (input) => await service.image_create(input as never),
    image_result: async (input) => await service.image_result(input as never),
  };
}

/** 判断任务状态是否为终态。 */
function is_terminal_status(status: string | undefined): boolean {
  return status === "succeeded" || status === "failed";
}

/** sleep 工具。 */
function delay_ms(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** 把等待参数夹到合法区间。 */
function clamp_wait_ms(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > MAX_WAIT_MS) return MAX_WAIT_MS;
  return Math.floor(value);
}

/** 拉取一次任务状态并校验。 */
async function fetch_job_once(
  context: CityCapabilityContext,
  job_id: string,
): Promise<ImageJobResult> {
  const current = await require_image_ai(context)
    .image_result({ job_id }) as unknown as ImageJobResult;
  validate_job_result(current);
  if (current.status === "succeeded" && current.result) {
    normalize_image_result(current.result);
  }
  return current;
}

/** 查询任务状态，必要时阻塞等待到终态。 */
async function read_job_result(
  context: CityCapabilityContext,
  input: { job_id: string; until_done?: boolean; max_wait_ms?: number; poll_interval_ms?: number },
): Promise<ImageJobResult> {
  const first = await fetch_job_once(context, input.job_id);
  if (!input.until_done) return first;
  if (is_terminal_status(first.status)) return first;

  const deadline = Date.now() + clamp_wait_ms(input.max_wait_ms ?? DEFAULT_WAIT_MS);
  const base_interval = clamp_wait_ms(input.poll_interval_ms ?? DEFAULT_POLL_MS);
  let current = first;
  while (Date.now() < deadline) {
    const provider_hint =
      typeof current.poll_after_ms === "number" && current.poll_after_ms > 0
        ? Math.floor(current.poll_after_ms)
        : 0;
    const wait_ms = Math.max(base_interval, provider_hint);
    const remaining = Math.max(0, deadline - Date.now());
    const sleep_ms = Math.min(wait_ms, remaining);
    if (sleep_ms === 0) break;
    await delay_ms(sleep_ms);
    current = await fetch_job_once(context, input.job_id);
    if (is_terminal_status(current.status)) return current;
  }
  return current;
}

/** 列出当前可用的图片模型。 */
const image_models_tool: CityCapabilityTool = {
  name: "image_models",
  description:
    "List models that can generate images. Call this when you do not know which image model to use.",
  input_schema: { type: "object", additionalProperties: false, properties: {} },
  async execute(_input, context): Promise<ActionResult> {
    const models = await require_image_ai(context)
      .catalog()
      .then((catalog) => catalog.all()) as unknown as ImageModel[];
    return { output: normalize_image_models(models), messages: [] };
  },
};

/** 创建一个异步图片生成任务。 */
const image_create_tool: CityCapabilityTool = {
  name: "image_create",
  description:
    "Create an async image job only after explicit user confirmation because image creation consumes quota. "
    + "Use prompt for text-only generation, or content for reference images and edits.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      model: { type: "string", description: "Image model id, as returned by image_models." },
      prompt: { type: "string", description: "Text-only generation prompt." },
      content: {
        type: "array",
        description:
          "Multimodal content for edits or reference images. Takes effect instead of prompt when present.",
        items: {
          type: "object",
          required: ["type"],
          properties: {
            type: { type: "string", enum: ["text", "image"] },
            text: { type: "string", description: "Text part content." },
            url: {
              type: "string",
              description: "Online URL, absolute local path, or Workspace-relative path. No data URLs.",
            },
            media_type: { type: "string", description: "Image MIME type." },
          },
        },
      },
      size: { type: "string", description: "Image size, for example 1024x1024." },
      aspect_ratio: { type: "string", description: "Aspect ratio, for example 16:9." },
      quality: { type: "string", description: "Image quality." },
      seed: { type: "number", description: "Random seed." },
    },
  },
  async execute(input, context): Promise<ActionResult> {
    const payload = normalize_image_payload(input as PluginJsonValue | undefined);
    const resolved = await normalize_image_create_input({
      workspace_path: context.workspace_path,
      payload,
    });
    const created = await require_image_ai(context)
      .image_create(resolved as unknown as PluginJsonObject) as unknown as ImageJobCreateResult;
    validate_created_job(created);
    return {
      output: created,
      messages: [],
    };
  },
};

/** 读取图片任务并本地化成功结果。 */
const image_result_tool: CityCapabilityTool = {
  name: "image_result",
  description:
    "Read an async image job. By default reads once; pass until_done=true to block-wait until "
    + "succeeded/failed or max_wait_ms times out.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["job_id"],
    properties: {
      job_id: { type: "string", description: "Image job id returned by image_create." },
      until_done: {
        type: "boolean",
        description:
          "If true, poll internally until the job reaches succeeded/failed or max_wait_ms elapses.",
      },
      max_wait_ms: {
        type: "number",
        description: "Total wait budget in milliseconds when until_done is true. Default 60000, cap 600000.",
      },
      poll_interval_ms: {
        type: "number",
        description:
          "Minimum delay between polls in milliseconds when until_done is true. Default 1500. Provider poll_after_ms overrides when larger.",
      },
    },
  },
  async execute(input, context): Promise<ActionResult> {
    const normalized = normalize_image_result_input(input as never);
    const current = await read_job_result(context, normalized);
    if (current.status === "failed") {
      throw new Error(describe_error(current.error ?? current.message ?? normalized.job_id));
    }
    if (current.status !== "succeeded" || !current.result) {
      return { output: current, messages: [] };
    }
    const localized = await localize_image_result({
      context: {
        files: context.files,
        ...(context.abort_signal ? { abort_signal: context.abort_signal } : {}),
      },
      job_id: current.job_id,
      result: current.result,
    });
    const warning = localized.errors.length
      ? `; ${localized.errors.length} image result(s) kept as remote URLs because local storage failed: ${localized.errors.join("; ")}`
      : "";
    return {
      output: { ...current, result: localized.result, warning: warning || undefined },
      messages: [{ role: "agent", parts: localized.result.parts }],
    };
  },
};

/** City 内置图片能力。 */
export function create_image_capability(): CityCapability {
  return {
    id: "image",
    tools: [image_models_tool, image_create_tool, image_result_tool],
    system(): string {
      return [
        "# Image capability",
        "",
        "Use `image_create` only when the user asks to create, edit, or otherwise produce an image.",
        "Do not call it for ordinary text answers, even if the message mentions visual ideas.",
        "Image creation consumes provider quota. Before calling `image_create`, you must ask the user to",
        "explicitly confirm the exact image creation/edit request. Do not call `image_create` just because",
        "the user discusses an image idea.",
        "",
        "## Tools",
        "",
        "- `image_models`: list currently available image models and return `{ items }`.",
        "  Call this first when you do not know which model to use. There is no configured default model,",
        "  so either the user specifies the model id or you must ask.",
        "- `image_create`: create an async image job after explicit user confirmation, returning `{ job_id, status }`.",
        "  - Text-only generation: pass `prompt` as a string.",
        "  - Edits or reference images: pass `content` as `[{ type: \"text\", text }, { type: \"image\", url }]`.",
        "    Multiple parts may appear in any order, and `content` takes effect instead of `prompt`.",
        "  - `url` accepts an online URL, an absolute local path, or a path relative to the Workspace root.",
        "    Do not pass base64/data URLs, and do not use the legacy `messages` field.",
        "  - `model` is required unless the user already named one. Other optional parameters are",
        "    `aspect_ratio` such as `16:9`, `size` such as `1024x1024`, `quality`, and `seed`.",
        "- `image_result`: read job status by `job_id`.",
        "  - By default it reads once. If the status is `queued` or `running`, save the `job_id` and check",
        "    again in a later turn; do not repeatedly poll in the same turn.",
        "  - To wait for the image directly, pass `until_done: true` with optional `max_wait_ms`",
        "    (default 60000, max 600000) and `poll_interval_ms` (default 1500).",
        "  - `succeeded`: returned image file parts are attached to the next assistant message.",
        "    Render them with Markdown image syntax: `![](url)`.",
        "  - `failed`: report the error truthfully. Do not invent image results.",
      ].join("\n");
    },
  };
}
