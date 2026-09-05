/**
 * ImagePlugin：图片生成插件。
 *
 * 关键点（中文）
 * - 对 Agent 暴露 `image_create` / `image_result` 两步式任务 action。
 * - 图片 AI 从运行时 Context 的 Embassy 能力读取；Workspace 文件能力由运行时 Context 提供。
 * - 成功结果中的远程图片会写入 Workspace，并同时保留本地引用与在线来源地址。
 */

import { z } from "zod";
import { create_action } from "@downcity/city/plugin";
import { Plugin } from "@downcity/city/plugin";
import type { PluginContext, PluginStartContext } from "@downcity/city/plugin";
import type {
  PluginJsonObject,
  PluginJsonValue,
} from "@downcity/city/plugin";
import type {
  ImageAiService,
  ImagePluginJobCreateResult,
  ImagePluginJobResult,
  ImagePluginJobResultInput,
  ImagePluginDefaultModel,
  ImagePluginModel,
  ImagePluginOptions,
} from "@/image/types/ImagePlugin.js";
import {
  apply_default_image_model,
  normalize_default_image_model,
  normalize_default_image_model_value,
  normalize_image_create_input,
  normalize_image_payload,
} from "@/image/runtime/ImageInputRuntime.js";
import {
  describe_error,
  normalize_image_models,
  normalize_image_result,
  normalize_image_result_payload,
  validate_created_job,
  validate_job_result,
} from "@/image/runtime/ImageProtocol.js";
import { localize_image_result } from "@/image/runtime/ImageResultStorage.js";
import { IMAGE_PLUGIN_SETTINGS } from "@/builtin/PluginSettingsDefinitions.js";
import { register_plugin_settings_actions } from "@/builtin/host/PluginSettingsActions.js";

const DEFAULT_IMAGE_PLUGIN_NAME = "image";
const DEFAULT_IMAGE_PLUGIN_TITLE = "Image";
const DEFAULT_IMAGE_PLUGIN_DESCRIPTION =
  "Generate images and return them as assistant file parts.";
/**
 * `image_result` 阻塞等待时的默认参数。
 *
 * 关键点（中文）
 * - DEFAULT_IMAGE_WAIT_MS：总等待上限（毫秒），避免 agent 单次调用挂太久。
 * - DEFAULT_IMAGE_POLL_MS：相邻两次轮询的最小间隔（毫秒）。
 * - MAX_IMAGE_WAIT_MS：用户参数硬上限，防止异常值导致 agent 永远等下去。
 */
const DEFAULT_IMAGE_WAIT_MS = 60_000;
const DEFAULT_IMAGE_POLL_MS = 1_500;
const MAX_IMAGE_WAIT_MS = 10 * 60_000;

/** 从 City 注入的 Embassy 获取图片 AI 服务。 */
function require_image_ai(context: PluginContext): ImageAiService {
  const service = context.city.embassy?.user.ai;
  if (!service) throw new Error("ImagePlugin requires a City Embassy user AI service");
  return {
    catalog: async () => await service.catalog(),
    image_create: async (input) => await service.image_create(input as never),
    image_result: async (input) => await service.image_result(input as never),
  };
}

/**
 * 判断任务状态是否已到达终态。
 */
function is_terminal_status(status: string | undefined): boolean {
  return status === "succeeded" || status === "failed";
}

/**
 * sleep 工具。
 */
function delay_ms(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * 把外部传入的等待参数夹到合法区间。
 */
function clamp_wait_ms(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > MAX_IMAGE_WAIT_MS) return MAX_IMAGE_WAIT_MS;
  return Math.floor(value);
}

const IMAGE_TEXT_CONTENT_SCHEMA = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const IMAGE_FILE_CONTENT_SCHEMA = z.object({
  type: z.literal("image"),
  url: z.string(),
  media_type: z.string().optional(),
});

const IMAGE_CREATE_INPUT_SCHEMA = z.object({
  model: z.string().optional(),
  prompt: z.string().optional(),
  content: z.array(z.union([
    IMAGE_TEXT_CONTENT_SCHEMA,
    IMAGE_FILE_CONTENT_SCHEMA,
  ])).optional(),
  n: z.number().optional(),
  count: z.number().optional(),
  size: z.string().optional(),
  aspect_ratio: z.string().optional(),
  ratio: z.string().optional(),
  quality: z.string().optional(),
  seed: z.number().optional(),
  client_job_id: z.string().optional(),
  provider_options: z.object({}).passthrough().optional(),
}).passthrough();

const IMAGE_RESULT_INPUT_SCHEMA = z.object({
  job_id: z.string(),
  until_done: z.boolean().optional(),
  max_wait_ms: z.number().optional(),
  poll_interval_ms: z.number().optional(),
}).passthrough();

/**
 * Agent 图片生成插件。
 */
export class ImagePlugin extends Plugin {
  /**
   * 当前 plugin 稳定名称。
   */
  readonly name: string;

  /**
   * 插件标题。
   */
  readonly title: string;

  /**
   * 插件说明。
   */
  readonly description: string;

  private readonly default_model?: ImagePluginDefaultModel;

  constructor(options: ImagePluginOptions = {}) {
    super();
    const name = String(options.name || DEFAULT_IMAGE_PLUGIN_NAME).trim();
    if (!name) {
      throw new Error("ImagePlugin requires a non-empty name");
    }
    this.name = name;
    this.title = String(options.title || DEFAULT_IMAGE_PLUGIN_TITLE).trim();
    this.description = String(
      options.description || DEFAULT_IMAGE_PLUGIN_DESCRIPTION,
    ).trim();
    this.default_model = normalize_default_image_model(options.default_model);
  }

  /** 注册 Image Plugin 的 Profile 配置 actions。 */
  start(context: PluginStartContext): void {
    register_plugin_settings_actions(context, IMAGE_PLUGIN_SETTINGS);
  }

  /**
   * 图片插件给模型的使用说明。
   */
  system(_context: PluginContext): string {
    return [
      "# Image Plugin",
      "",
      "Use this plugin only when the user asks to create, edit, or otherwise produce an image.",
      "Do not call it for ordinary text answers, even if the message mentions visual ideas.",
      "Image creation consumes provider quota. Before calling `image_create`, you must ask the user to explicitly confirm the exact image creation/edit request. Do not call `image_create` just because the user discusses an image idea.",
      "",
      "## Actions",
      "",
      "- `models`: list currently available image models and return `{ models }`.",
      "  Call this first when you do not know which model to use and the plugin has no default image model. Let the user or current task context specify the model ID.",
      "- `image_create`: create an async image job after explicit user confirmation, returning `{ job_id, status }`.",
      "  - Text-only generation: pass `prompt` as a string.",
      "  - Edits or reference images: pass `content` in this shape:",
      "    `[{ type: \"text\", text }, { type: \"image\", url }]`. Multiple text parts and images may appear in any order.",
      "  - If both `content` and `prompt` are provided, `content` takes effect and `prompt` is ignored.",
      "  - `url` supports three forms: online URL, absolute local path, or a relative path from the Agent project root.",
      "    Do not pass base64/data URLs, and do not use the legacy `messages` field.",
      "  - `model` is optional. If omitted, the plugin-configured default image model is used. Optional parameters include `aspect_ratio` such as `16:9`, `size` such as `1024x1024`, `quality`, and `seed`.",
      "- `image_result`: read job status by `job_id`.",
      "  - By default, read once. If the status is `queued` or `running`, save the `job_id` and check again in a later turn; do not repeatedly poll in the same turn.",
      "  - To wait for the image directly, pass `until_done: true` with optional `max_wait_ms` (default 60000, max 600000) and `poll_interval_ms` (default 1500). If the wait times out, the latest intermediate status is returned.",
      "  - `succeeded`: returned image file parts are automatically written to disk and attached to the next assistant message. You do not need to assemble the image manually.",
      "  - When replying to the user, you can render images with Markdown image syntax: `![](url)`.",
      "  - `failed`: report the `error` truthfully to the user. Do not invent image results.",
      "",
      "## Flow",
      "",
      "1. If the plugin has no default image model, confirm the model ID first; call `models` when model selection is needed.",
      "2. Explain to the user that image generation will consume image quota, and wait for explicit confirmation.",
      "3. After the user confirms, call `image_create` to get a `job_id`.",
      "4. Query with `image_result`; short jobs may use `until_done: true` to get the result in one call, while long jobs should save the `job_id` and check again in a later turn.",
      "",
      "When unsure, use `plugin_read { plugin: \"image\", action: \"...\" }` to inspect each action's complete input schema and examples.",
    ].join("\n");
  }

  /**
   * 查询图片任务当前状态。
   */
  private async read_image_result(
    input: ImagePluginJobResultInput,
    context: PluginContext,
  ): Promise<ImagePluginJobResult> {
    const first = await this.fetch_job_once(input.job_id, context);
    if (!input.until_done) return first;
    if (is_terminal_status(first.status)) return first;

    const deadline =
      Date.now() + clamp_wait_ms(input.max_wait_ms ?? DEFAULT_IMAGE_WAIT_MS);
    const base_interval = clamp_wait_ms(
      input.poll_interval_ms ?? DEFAULT_IMAGE_POLL_MS,
    );
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
      current = await this.fetch_job_once(input.job_id, context);
      if (is_terminal_status(current.status)) return current;
    }
    return current;
  }

  /**
   * 拉取一次任务状态并校验。
   */
  private async fetch_job_once(
    job_id: string,
    context: PluginContext,
  ): Promise<ImagePluginJobResult> {
    const current = await require_image_ai(context).image_result({ job_id }) as unknown as ImagePluginJobResult;
    validate_job_result(current);
    if (current.status === "succeeded" && current.result) {
      normalize_image_result(current.result);
    }
    return current;
  }

  /**
   * 显式 action 集合。
   */
  readonly actions = {
    models: create_action({
      description: "List image-capable models available to ImagePlugin.",
      input_schema: z.object({}).passthrough(),
      execute: async ({ context }) => {
        try {
          const models = await require_image_ai(context).catalog().then((catalog) => catalog.all()) as unknown as ImagePluginModel[];
          const result = normalize_image_models(models);
          return {
            success: true,
            data: result as unknown as PluginJsonObject,
            message: "image models listed",
          };
        } catch (error) {
          return {
            success: false,
            error: describe_error(error),
            message: describe_error(error),
          };
        }
      },
    }),
    image_create: create_action({
      description:
        "Create an async image job only after explicit user confirmation because image creation consumes quota. Use prompt for text-only generation, or content for reference images and edits.",
      input_schema: {
        zod: IMAGE_CREATE_INPUT_SCHEMA,
        json_schema: {
          type: "object",
          additionalProperties: true,
          properties: {
            model: { type: "string", description: "Image model id." },
            prompt: {
              type: "string",
              description:
                "Text-only image prompt. Ask the user to confirm before calling image_create. Ignored when content is present.",
            },
            content: {
              type: "array",
              description:
                "Multimodal content for image edits or reference images. Ask the user to confirm before calling image_create.",
              items: {
                oneOf: [
                  {
                    type: "object",
                    required: ["type", "text"],
                    properties: {
                      type: { const: "text" },
                      text: { type: "string" },
                    },
                  },
                  {
                    type: "object",
                    required: ["type", "url"],
                    properties: {
                      type: { const: "image" },
                      url: {
                        type: "string",
                        description:
                          "Online URL, absolute local path, or path relative to the Agent project root.",
                      },
                      media_type: { type: "string" },
                    },
                  },
                ],
              },
            },
            aspect_ratio: { type: "string", description: "Aspect ratio, for example 16:9." },
            size: { type: "string", description: "Image size, for example 1024x1024." },
            quality: { type: "string", description: "Image quality." },
            seed: { type: "number", description: "Random seed." },
          },
        },
      },
      examples: [
        {
          title: "Text-only image",
          payload: {
            model: "image-model-id",
            prompt: "A cinematic illustration of a rainy city corner at night",
            aspect_ratio: "16:9",
          },
        },
        {
          title: "Edit image with local reference",
          payload: {
            model: "image-model-id",
            content: [
              { type: "text", text: "Change this image to a white studio background" },
              { type: "image", url: "./input.png" },
            ],
          },
        },
      ],
      execute: async ({ context, input }: { context: PluginContext; input: PluginJsonValue }) => {
        try {
          const normalized_payload = normalize_image_payload(input);
          const normalized_input = await apply_default_image_model(
            context,
            await normalize_image_create_input(context, normalized_payload),
            this.default_model ?? normalize_default_image_model_value(
              typeof context.config.default_model === "string"
                ? context.config.default_model
                : undefined,
            ),
          );
          const created = await require_image_ai(context).image_create(normalized_input as unknown as PluginJsonObject) as unknown as ImagePluginJobCreateResult;
          validate_created_job(created);
          return {
            success: true,
            data: created as unknown as PluginJsonObject,
            message: "image job created",
          };
        } catch (error) {
          return {
            success: false,
            error: describe_error(error),
            message: describe_error(error),
          };
        }
      },
    }),
    image_result: create_action({
      description:
        "Read an async image job. By default reads once; pass until_done=true to block-wait until succeeded/failed or max_wait_ms times out.",
      input_schema: {
        zod: IMAGE_RESULT_INPUT_SCHEMA,
        json_schema: {
          type: "object",
          required: ["job_id"],
          properties: {
            job_id: {
              type: "string",
              description: "Image job id returned by image_create.",
            },
            until_done: {
              type: "boolean",
              description:
                "If true, the plugin internally polls until the job reaches a terminal state (succeeded/failed) or max_wait_ms elapses.",
            },
            max_wait_ms: {
              type: "number",
              description:
                "Total wait budget in milliseconds when until_done is true. Default 60000, hard cap 600000.",
            },
            poll_interval_ms: {
              type: "number",
              description:
                "Minimum delay between polls in milliseconds when until_done is true. Default 1500. Provider poll_after_ms overrides when larger.",
            },
          },
        },
      },
      examples: [
        {
          title: "Read image job",
          payload: {
            job_id: "img_123",
          },
        },
        {
          title: "Wait until done",
          payload: {
            job_id: "img_123",
            until_done: true,
            max_wait_ms: 30000,
          },
        },
      ],
      execute: async ({ context, execution, input }) => {
        try {
          const normalized_input = normalize_image_result_payload(input);
          const current = await this.read_image_result(normalized_input, context);
          if (current.status === "failed") {
            return {
              success: false,
              data: current as unknown as PluginJsonObject,
              error: current.error ?? current.message ?? normalized_input.job_id,
              message: current.error ?? current.message ?? "image job failed",
            };
          }
          const localized = current.status === "succeeded" && current.result
            ? await localize_image_result({
                context,
                job_id: current.job_id,
                result: current.result,
                abort_signal: execution.abort_signal,
              })
            : undefined;
          const output = localized
            ? { ...current, result: localized.result }
            : current;
          const localization_warning = localized?.errors.length
            ? `; ${localized.errors.length} image result(s) kept as remote URLs because local storage failed: ${localized.errors.join("; ")}`
            : "";
          return {
            success: true,
            data: output as unknown as PluginJsonObject,
            message:
              current.status === "succeeded"
                ? `image generated${localization_warning}`
                : `image job ${current.status}`,
            ...(output.status === "succeeded" && output.result
              ? {
                  messages: [output.result],
                }
              : {}),
          };
        } catch (error) {
          return {
            success: false,
            error: describe_error(error),
            message: describe_error(error),
          };
        }
      },
    }),
  };
}
