/**
 * city tool `image` method：City 自己拥有的图片生成能力。
 *
 * 关键点（中文）
 * - 三个动作：`models`、`create`、`result`；都能消耗配额或写文件，声明为 write。
 * - 图片 AI 来自 City 持有的 Embassy；本地图片读取以当前 Workspace 为根。
 * - `result` 把远端图片落到 method 私有目录，只返回本地路径，不注入 Agent 消息。
 */

import type { PluginJsonObject, PluginJsonValue } from "@/plugin/index.js";
import type { CityToolArgSpec, CityToolContext } from "@/city/types/CityTool.js";
import type {
  ImageAiService,
  ImageCreateInput,
  ImageJobCreateResult,
  ImageJobResult,
  ImageModel,
  ImageResultOutput,
} from "@/city/tool/methods/image/types/Image.js";
import {
  describe_error,
  normalize_image_models,
  normalize_image_result,
  normalize_image_result_input,
  validate_created_job,
  validate_job_result,
} from "@/city/tool/methods/image/runtime/ImageProtocol.js";
import {
  normalize_image_create_input,
  normalize_image_payload,
} from "@/city/tool/methods/image/runtime/ImageInput.js";
import { localize_image_result } from "@/city/tool/methods/image/runtime/ImageResultStorage.js";
import {
  CityAction,
  string_arg,
  type CityToolArgs,
} from "@/city/tool/CityAction.js";
import { CityMethod } from "@/city/tool/CityMethod.js";

/** `result` 阻塞等待时的默认与上限参数。 */
const DEFAULT_WAIT_MS = 60_000;
const DEFAULT_POLL_MS = 1_500;
const MAX_WAIT_MS = 10 * 60_000;

/** 从 City 注入的 Embassy 获取图片 AI 服务。 */
function require_image_ai(context: CityToolContext): ImageAiService {
  const service = context.embassy?.user.ai;
  if (!service) throw new Error("image method requires a City Embassy user AI service");
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
  context: CityToolContext,
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
  context: CityToolContext,
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
class ImageModelsAction extends CityAction {
  readonly action = "models";
  readonly summary = "List models that can generate images.";
  readonly returns = "items(id, name, description, modalities, tags, meta)";
  readonly capability = "read";

  protected async run(
    _args: CityToolArgs,
    context: CityToolContext,
  ): Promise<ReturnType<typeof normalize_image_models>> {
    const models = await require_image_ai(context)
      .catalog()
      .then((catalog) => catalog.all()) as unknown as ImageModel[];
    return normalize_image_models(models);
  }
}

/** 创建一个异步图片生成任务。 */
class ImageCreateAction extends CityAction {
  readonly action = "create";
  readonly summary =
    "Create an async image job. Consumes quota, so confirm with the user first. "
    + "Use prompt for text-only generation, or content for reference images and edits.";
  readonly returns = "job_id, status, poll_after_ms";
  readonly capability = "write";
  readonly args: readonly CityToolArgSpec[] = [
    string_arg("model", "Image model id, as returned by the models action."),
    {
      name: "prompt",
      type: "string",
      required: false,
      description: "Text-only generation prompt.",
    },
    {
      name: "content",
      type: "json",
      required: false,
      description:
        "Multimodal content for edits or reference images, as JSON parts "
        + "[{type:\"text\",text},{type:\"image\",url}]. Takes effect instead of prompt when present.",
    },
    { name: "size", type: "string", required: false, description: "Image size, for example 1024x1024." },
    { name: "aspect_ratio", type: "string", required: false, description: "Aspect ratio, for example 16:9." },
    { name: "quality", type: "string", required: false, description: "Image quality." },
    { name: "seed", type: "number", required: false, description: "Random seed." },
  ];

  protected async run(args: CityToolArgs, context: CityToolContext): Promise<ImageJobCreateResult> {
    const payload = normalize_image_payload(args as PluginJsonValue | undefined);
    const resolved = await normalize_image_create_input({
      workspace_path: context.workspace_path,
      payload: payload as ImageCreateInput,
    });
    const created = await require_image_ai(context)
      .image_create(resolved as unknown as PluginJsonObject) as unknown as ImageJobCreateResult;
    validate_created_job(created);
    return created;
  }
}

/** 读取图片任务，并把成功结果本地化。 */
class ImageResultAction extends CityAction {
  readonly action = "result";
  readonly summary =
    "Read an async image job. Reads once by default; pass until_done=true to wait for the terminal state.";
  readonly returns =
    "job_id, status, files(local absolute paths), warning(files that stayed remote)";
  readonly capability = "write";
  readonly args: readonly CityToolArgSpec[] = [
    string_arg("job_id", "Image job id returned by the create action."),
    {
      name: "until_done",
      type: "boolean",
      required: false,
      description: "Poll until the job reaches succeeded/failed or max_wait_ms elapses.",
    },
    {
      name: "max_wait_ms",
      type: "number",
      required: false,
      description: "Total wait budget in milliseconds. Default 60000, cap 600000.",
    },
    {
      name: "poll_interval_ms",
      type: "number",
      required: false,
      description: "Minimum delay between polls. Default 1500; provider poll_after_ms wins when larger.",
    },
  ];

  protected async run(args: CityToolArgs, context: CityToolContext): Promise<ImageResultOutput> {
    const normalized = normalize_image_result_input(args as PluginJsonValue | undefined);
    const current = await read_job_result(context, normalized);
    if (current.status === "failed") {
      throw new Error(describe_error(current.error ?? current.message ?? normalized.job_id));
    }
    if (current.status !== "succeeded" || !current.result) {
      return { job_id: current.job_id, status: current.status, files: [] };
    }
    const localized = await localize_image_result({
      context: {
        files: context.files,
        ...(context.abort_signal ? { abort_signal: context.abort_signal } : {}),
      },
      job_id: current.job_id,
      result: current.result,
    });
    const files = localized.result.parts.flatMap((part) =>
      part.type === "file" && part.url.trim() ? [part.url.trim()] : []);
    return {
      job_id: current.job_id,
      status: "succeeded",
      files,
      ...(localized.errors.length > 0
        ? {
            warning:
              `${localized.errors.length} image file(s) kept as remote URLs because local storage failed: `
              + localized.errors.join("; "),
          }
        : {}),
    };
  }
}

/** `image` method。 */
export class ImageMethod extends CityMethod {
  readonly method = "image";
  readonly summary = "Generate images through City-owned image models.";
  protected readonly actions = [
    new ImageModelsAction(),
    new ImageCreateAction(),
    new ImageResultAction(),
  ];

  system(): string {
    return [
      "# Image method",
      "",
      "Use `image.create` only when the user asks to create, edit, or otherwise produce an image.",
      "Do not call it for ordinary text answers, even if the message mentions visual ideas.",
      "Image creation consumes provider quota. Before calling `create`, you must ask the user to",
      "explicitly confirm the exact image creation/edit request.",
      "",
      "## Actions",
      "",
      "- `models`: list available image models. Call this first when you do not know which model to use;",
      "  there is no configured default, so either the user names the model or you must ask.",
      "- `create`: create an async image job, returning `{ job_id, status }`.",
      "  - Text-only generation: pass `prompt`.",
      "  - Edits or reference images: pass `content` as",
      "    `[{ type: \"text\", text }, { type: \"image\", url }]`. Multiple parts may appear in any order,",
      "    and `content` takes effect instead of `prompt`.",
      "  - `url` accepts an online URL, an absolute local path, or a path relative to the Workspace root.",
      "    Do not pass base64/data URLs.",
      "  - Optional parameters: `aspect_ratio` such as `16:9`, `size` such as `1024x1024`, `quality`, `seed`.",
      "- `result`: read job status by `job_id`.",
      "  - By default it reads once. If the status is `queued` or `running`, save the `job_id` and check",
      "    again in a later turn; do not repeatedly poll in the same turn.",
      "  - To wait for the image directly, pass `until_done: true` with optional `max_wait_ms`",
      "    (default 60000, max 600000) and `poll_interval_ms` (default 1500).",
      "  - On success it returns `files` with the local absolute paths of the generated images.",
      "    Render them in your reply with Markdown image syntax: `![](path)`.",
      "  - On failure it reports the provider error. Never invent image results.",
    ].join("\n");
  }
}
