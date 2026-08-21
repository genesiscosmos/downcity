/**
 * SoundPlugin：统一的语音识别与语音合成插件。
 *
 * 关键点（中文）
 * - 对 Agent 暴露 `models`、`asr`、`tts` 三个 action。
 * - 模型目录与真实 ASR/TTS 能力通过构造参数注入窄服务接口。
 * - 本地音频只负责读取并转换为 data URL，不加载或运行任何本地语音模型。
 * - TTS 返回已经落盘的本地音频 UIMessage Parts，并由 Action 声明 Assistant Message。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { BasePlugin, create_action } from "@downcity/agent";
import { z } from "zod";
import type { PluginContext, JsonObject, JsonValue } from "@downcity/agent";
import { CHAT_PLUGIN_POINTS } from "@/chat/runtime/PluginPoints.js";
import type {
  ChatInboundAugmentInput,
  ChatPluginAttachment,
} from "@/chat/types/ChatPlugin.js";
import type {
  SoundPluginAsrInput,
  SoundPluginAsrResult,
  SoundPluginAsrSegment,
  SoundPluginCapability,
  SoundPluginModel,
  SoundPluginModelsResult,
  SoundPluginOptions,
  SoundPluginTtsInput,
  SoundPluginTtsResult,
} from "@/sound/types/SoundPlugin.js";

const DEFAULT_SOUND_PLUGIN_NAME = "sound";
const DEFAULT_SOUND_PLUGIN_TITLE = "Sound";
const DEFAULT_SOUND_PLUGIN_DESCRIPTION =
  "Transcribe audio and synthesize speech through FED-provided models.";
const DEFAULT_AUDIO_MEDIA_TYPE = "audio/mpeg";

const AUDIO_MEDIA_TYPES: Record<string, string> = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

const SOUND_MODELS_INPUT_SCHEMA = z.object({
  capability: z.enum(["asr", "tts"]).optional(),
}).passthrough();

const SOUND_ASR_INPUT_SCHEMA = z.object({
  model: z.string().optional(),
  audio_path: z.string().optional(),
  url: z.string().optional(),
  data_url: z.string().optional(),
  language: z.string().optional(),
  media_type: z.string().optional(),
  filename: z.string().optional(),
  provider_options: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const SOUND_TTS_INPUT_SCHEMA = z.object({
  model: z.string().optional(),
  text: z.string(),
  language: z.string().optional(),
  voice: z.string().optional(),
  format: z.string().optional(),
  speed: z.number().optional(),
  instructions: z.string().optional(),
  provider_options: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

/**
 * 判断值是否为普通对象。
 */
function to_record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * 把异常及 cause 链整理为可读文本。
 */
function describe_error(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts = [error.message || error.name || "Error"];
  let current: unknown = error.cause;
  let depth = 0;
  while (current && depth < 3) {
    if (!(current instanceof Error)) {
      parts.push(String(current));
      break;
    }
    const code = (current as { code?: unknown }).code;
    const code_text = typeof code === "string" && code ? `[${code}] ` : "";
    parts.push(`${code_text}${current.message || current.name}`.trim());
    current = current.cause;
    depth += 1;
  }
  return parts.filter(Boolean).join(" :: ");
}

/**
 * 归一化可选字符串。
 */
function normalize_optional_string(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

/**
 * XML 文本转义。
 */
function escape_xml_text(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * XML 属性转义。
 */
function escape_xml_attr(value: string): string {
  return escape_xml_text(value).replace(/"/g, "&quot;");
}

/**
 * 归一化模型筛选 action 的 payload。
 */
function normalize_models_capability(
  payload: JsonValue | undefined,
): SoundPluginCapability | undefined {
  const record = to_record(payload ?? {});
  if (!record) {
    throw new TypeError("SoundPlugin.models payload must be an object");
  }
  const capability = normalize_optional_string(record.capability);
  if (!capability) return undefined;
  if (capability !== "asr" && capability !== "tts") {
    throw new TypeError("SoundPlugin.models capability must be asr or tts");
  }
  return capability;
}

/**
 * 归一化 ASR action payload。
 */
function normalize_asr_payload(payload: JsonValue | undefined): SoundPluginAsrInput {
  const record = to_record(payload ?? {});
  if (!record) {
    throw new TypeError("SoundPlugin.asr payload must be an object");
  }
  const audio_path = normalize_optional_string(record.audio_path);
  const url = normalize_optional_string(record.url);
  const data_url = normalize_optional_string(record.data_url);
  const source_count = [audio_path, url, data_url].filter(Boolean).length;
  if (source_count !== 1) {
    throw new TypeError("SoundPlugin.asr requires exactly one of audio_path, url, or data_url");
  }
  return {
    ...(record as SoundPluginAsrInput),
    ...(audio_path ? { audio_path } : {}),
    ...(url ? { url } : {}),
    ...(data_url ? { data_url } : {}),
  };
}

/**
 * 归一化 TTS action payload。
 */
function normalize_tts_payload(payload: JsonValue | undefined): SoundPluginTtsInput {
  const record = to_record(payload ?? {});
  if (!record) {
    throw new TypeError("SoundPlugin.tts payload must be an object");
  }
  const text = normalize_optional_string(record.text);
  if (!text) {
    throw new TypeError("SoundPlugin.tts requires text");
  }
  return {
    ...(record as SoundPluginTtsInput),
    text,
  };
}

/**
 * 推断本地音频 MIME 类型。
 */
function infer_audio_media_type(file_path: string, fallback?: string): string {
  const normalized_fallback = normalize_optional_string(fallback);
  if (normalized_fallback) return normalized_fallback;
  return AUDIO_MEDIA_TYPES[path.extname(file_path).toLowerCase()] ?? DEFAULT_AUDIO_MEDIA_TYPE;
}

/**
 * 把本地音频读取为 FED 可直接接收的 data URL。
 */
async function local_audio_to_data_url(input: {
  /** 当前 Agent 项目根目录。 */
  root_path: string;
  /** 音频绝对路径或相对项目根目录的路径。 */
  audio_path: string;
  /** 调用方显式提供的 MIME 类型。 */
  media_type?: string;
}): Promise<{ data_url: string; media_type: string; filename: string }> {
  const file_path = path.isAbsolute(input.audio_path)
    ? path.resolve(input.audio_path)
    : path.resolve(input.root_path, input.audio_path);
  const media_type = infer_audio_media_type(file_path, input.media_type);
  const bytes = await fs.readFile(file_path);
  return {
    data_url: `data:${media_type};base64,${bytes.toString("base64")}`,
    media_type,
    filename: path.basename(file_path),
  };
}

/**
 * 把 Agent 公开 ASR 输入解析为可直接发送给 FED 的输入。
 */
async function resolve_asr_input(
  context: PluginContext,
  input: SoundPluginAsrInput,
): Promise<SoundPluginAsrInput> {
  if (!input.audio_path) return input;
  const local = await local_audio_to_data_url({
    root_path: context.workspace_path,
    audio_path: input.audio_path,
    media_type: input.media_type,
  });
  const { audio_path: _audio_path, ...rest } = input;
  return {
    ...rest,
    data_url: local.data_url,
    media_type: local.media_type,
    filename: normalize_optional_string(input.filename) ?? local.filename,
  };
}

/**
 * 为指定能力解析模型 ID。
 */
function resolve_model_id(
  capability: SoundPluginCapability,
  input_model: unknown,
  default_model: string | undefined,
): string {
  const model = normalize_optional_string(input_model) ?? default_model;
  if (model) return model;
  throw new TypeError(
    `SoundPlugin.${capability} requires a model id; call sound.models first or configure default_${capability}_model`,
  );
}

/**
 * 归一化 JSON 对象。
 */
function normalize_json_object(value: unknown): JsonObject | undefined {
  const record = to_record(value);
  return record ? record as JsonObject : undefined;
}

/**
 * 归一化单个 FED 语音模型。
 */
function normalize_sound_model(value: SoundPluginModel): SoundPluginModel | null {
  const record = to_record(value);
  if (!record) return null;
  const id = normalize_optional_string(record.id);
  if (!id) return null;
  const modalities = Array.isArray(record.modalities)
    ? record.modalities
        .map((item) => normalize_optional_string(item))
        .filter((item): item is string => Boolean(item))
    : [];
  if (!modalities.includes("asr") && !modalities.includes("tts")) return null;
  const tags = Array.isArray(record.tags)
    ? record.tags
        .map((item) => normalize_optional_string(item))
        .filter((item): item is string => Boolean(item))
    : undefined;
  const meta = normalize_json_object(record.meta);
  return {
    id,
    name: normalize_optional_string(record.name) ?? id,
    ...(typeof record.description === "string"
      ? { description: record.description.trim() }
      : {}),
    modalities,
    ...(tags?.length ? { tags } : {}),
    ...(meta ? { meta } : {}),
  };
}

/**
 * 归一化并筛选 FED 语音模型列表。
 */
function normalize_sound_models(
  values: SoundPluginModel[],
  capability?: SoundPluginCapability,
): SoundPluginModelsResult {
  const items = values
    .map((item) => normalize_sound_model(item))
    .filter((item): item is SoundPluginModel => item !== null)
    .filter((item) => !capability || item.modalities.includes(capability));
  return { items };
}

/**
 * 校验并归一化单个 ASR 分段。
 */
function normalize_asr_segment(value: unknown): SoundPluginAsrSegment | null {
  const record = to_record(value);
  if (!record) return null;
  const text = normalize_optional_string(record.text);
  if (!text) return null;
  const start_second = Number(record.startSecond);
  const end_second = Number(record.endSecond);
  if (!Number.isFinite(start_second) || !Number.isFinite(end_second)) return null;
  return {
    text,
    startSecond: start_second,
    endSecond: end_second,
  };
}

/**
 * 校验并归一化 ASR 返回结果。
 */
function normalize_asr_result(result: SoundPluginAsrResult): SoundPluginAsrResult {
  const record = to_record(result);
  const text = normalize_optional_string(record?.text);
  if (!record || !text) {
    throw new TypeError("SoundPlugin asr function must return transcription text");
  }
  const segments = Array.isArray(record.segments)
    ? record.segments
        .map((item) => normalize_asr_segment(item))
        .filter((item): item is SoundPluginAsrSegment => item !== null)
    : undefined;
  const language = normalize_optional_string(record.language);
  const duration_in_seconds = Number(record.durationInSeconds);
  return {
    text,
    ...(segments ? { segments } : {}),
    ...(language ? { language } : {}),
    ...(Number.isFinite(duration_in_seconds) && duration_in_seconds >= 0
      ? { durationInSeconds: duration_in_seconds }
      : {}),
  };
}

/**
 * 校验 TTS 返回的 AI SDK UIMessage。
 */
function normalize_tts_result(result: SoundPluginTtsResult): SoundPluginTtsResult {
  const record = to_record(result);
  if (!record || !Array.isArray(record.parts)) {
    throw new TypeError("SoundPlugin tts function must return an AI SDK UIMessage");
  }
  const has_audio_file = record.parts.some((part) => {
    const part_record = to_record(part);
    return part_record?.type === "file"
      && typeof part_record.mediaType === "string"
      && part_record.mediaType.startsWith("audio/");
  });
  if (!has_audio_file) {
    throw new TypeError("SoundPlugin tts UIMessage must contain an audio file part");
  }
  for (const part of record.parts) {
    const part_record = to_record(part);
    if (part_record?.type !== "file") continue;
    const url = String(part_record.url || "").trim();
    if (!url || url.startsWith("data:") || /^https?:\/\//i.test(url)) {
      throw new TypeError(
        "SoundPlugin tts file parts must be saved locally before returning",
      );
    }
  }
  return result;
}

/**
 * 生成 chat 入站附件的展示路径。
 */
function to_display_src(root_path: string, attachment: ChatPluginAttachment): string {
  const raw = normalize_optional_string(attachment.path)
    ?? attachment.fileName
    ?? attachment.attachmentId
    ?? attachment.kind;
  const normalized_root = path.resolve(root_path);
  const normalized_raw = path.isAbsolute(raw) ? path.resolve(raw) : raw;
  if (
    path.isAbsolute(normalized_raw)
    && normalized_raw.startsWith(`${normalized_root}${path.sep}`)
  ) {
    return normalized_raw.slice(normalized_root.length + 1);
  }
  return raw;
}

/**
 * 把自动转写结果追加到 chat 正文。
 */
function append_voice_text(
  input: ChatInboundAugmentInput,
  voice_blocks: string[],
): ChatInboundAugmentInput {
  const current = String(input.body_text || "").trim();
  const addition = voice_blocks.map((item) => item.trim()).filter(Boolean).join("\n\n");
  if (!addition) return input;
  return {
    ...input,
    body_text: [current, addition].filter(Boolean).join("\n\n"),
  };
}

/**
 * Agent 统一语音插件。
 */
export class SoundPlugin extends BasePlugin {
  /** 当前 plugin 稳定名称。 */
  readonly name: string;

  /** Plugin 展示标题。 */
  readonly title: string;

  /** Plugin 用途说明。 */
  readonly description: string;

  private readonly default_asr_model?: string;
  private readonly default_tts_model?: string;
  private readonly auto_asr: boolean;
  private readonly language?: string;
  private readonly voice?: string;
  private readonly format?: string;
  /** 当前实例使用的语音 AI 服务。 */
  private readonly sound_ai: SoundPluginOptions["sound_ai"];

  constructor(options: SoundPluginOptions) {
    super();
    this.sound_ai = options.sound_ai;
    const name = normalize_optional_string(options.name) ?? DEFAULT_SOUND_PLUGIN_NAME;
    const default_asr_model = normalize_optional_string(options.default_asr_model);
    if (options.auto_asr === true && !default_asr_model) {
      throw new TypeError("SoundPlugin auto_asr requires default_asr_model");
    }
    this.name = name;
    this.title = normalize_optional_string(options.title) ?? DEFAULT_SOUND_PLUGIN_TITLE;
    this.description = normalize_optional_string(options.description)
      ?? DEFAULT_SOUND_PLUGIN_DESCRIPTION;
    this.default_asr_model = default_asr_model;
    this.default_tts_model = normalize_optional_string(options.default_tts_model);
    this.auto_asr = options.auto_asr === true;
    this.language = normalize_optional_string(options.language);
    this.voice = normalize_optional_string(options.voice);
    this.format = normalize_optional_string(options.format);
  }

  /**
   * SoundPlugin 给 Agent 的使用说明。
   */
  system(_context: PluginContext): string {
    return [
      "# Sound Plugin",
      "",
      "Use this plugin for speech recognition (ASR) and text-to-speech (TTS).",
      "Do not call TTS for ordinary text replies unless the user explicitly requests audio.",
      this.auto_asr
        ? "Inbound voice/audio chat attachments are automatically transcribed into `<voice src=\"...\">...</voice>` blocks."
        : "Automatic inbound transcription is disabled; call `asr` explicitly when needed.",
      "",
      "## Actions",
      "",
      "- `models`: list FED models whose modalities include `asr` or `tts`. Pass `capability` to filter the list.",
      "- `asr`: transcribe audio. Provide one of `audio_path`, `url`, or `data_url`.",
      "- `tts`: synthesize speech from required `text` and return an audio file part.",
      "",
      "## Model selection",
      "",
      "Pass the selected FED model ID in `model`. When no plugin default is configured, call `models` first with the required capability.",
      "Never use an ASR-only model for TTS or a TTS-only model for ASR.",
      "",
      "## Results",
      "",
      "ASR returns transcript text and may include timed segments, language, and duration.",
      "TTS returns an AI SDK UIMessage whose audio file part already points to a local file, and that part is attached to the assistant response.",
      "Do not invent a transcript or audio result when a FED call fails.",
      "",
      `When unsure, use \`plugin_read { plugin: \"${this.name}\", action: \"...\" }\` to inspect the complete schema.`,
    ].join("\n");
  }

  /**
   * 执行一次 ASR 转写。
   */
  private async transcribe(
    context: PluginContext,
    input: SoundPluginAsrInput,
  ): Promise<SoundPluginAsrResult> {
    const model = resolve_model_id("asr", input.model, this.default_asr_model);
    const resolved_input = await resolve_asr_input(context, {
      ...(this.language ? { language: this.language } : {}),
      ...input,
      model,
    });
    return normalize_asr_result(
      await this.sound_ai.asr(resolved_input as unknown as JsonObject) as unknown as SoundPluginAsrResult,
    );
  }

  /**
   * 执行一次 TTS 合成。
   */
  private async synthesize(context: PluginContext, input: SoundPluginTtsInput): Promise<SoundPluginTtsResult> {
    const model = resolve_model_id("tts", input.model, this.default_tts_model);
    const result = await this.sound_ai.tts({
      ...(this.language ? { language: this.language } : {}),
      ...(this.voice ? { voice: this.voice } : {}),
      ...(this.format ? { format: this.format } : {}),
      ...input,
      model,
    });
    return normalize_tts_result(result as unknown as SoundPluginTtsResult);
  }

  /**
   * 自动转写 chat 入站语音附件。
   */
  private async auto_transcribe_inbound(input: {
    /** 当前 Agent 上下文。 */
    context: PluginContext;
    /** chat 入站管道值。 */
    value: JsonValue;
  }): Promise<JsonValue> {
    if (!this.auto_asr) return input.value;
    const inbound = input.value as unknown as ChatInboundAugmentInput;
    const voice_attachments = (Array.isArray(inbound.attachments) ? inbound.attachments : [])
      .filter((item) =>
        (item.kind === "voice" || item.kind === "audio")
        && Boolean(normalize_optional_string(item.path))
      );
    if (voice_attachments.length === 0) return input.value;

    const voice_blocks: string[] = [];
    for (const attachment of voice_attachments) {
      try {
        const result = await this.transcribe(input.context, {
          audio_path: String(attachment.path || "").trim(),
          ...(attachment.contentType ? { media_type: attachment.contentType } : {}),
          ...(attachment.fileName ? { filename: attachment.fileName } : {}),
        });
        const src = to_display_src(input.context.workspace_path, attachment);
        voice_blocks.push(
          `<voice src="${escape_xml_attr(src)}">${escape_xml_text(result.text)}</voice>`,
        );
      } catch {
        // 关键点（中文）：自动转写失败不阻塞 chat 主消息链路。
      }
    }
    return append_voice_text(inbound, voice_blocks) as unknown as JsonValue;
  }

  /**
   * chat pipeline 扩展点。
   */
  readonly hooks = {
    pipeline: {
      [CHAT_PLUGIN_POINTS.augmentInbound]: [
        async ({ context, value }: { context: PluginContext; value: JsonValue }) =>
          await this.auto_transcribe_inbound({ context, value }),
      ],
    },
  };

  /**
   * 显式 action 集合。
   */
  readonly actions = {
    models: create_action({
      description: "List FED models that support ASR or TTS.",
      input_schema: {
        zod: SOUND_MODELS_INPUT_SCHEMA,
        json_schema: {
          type: "object",
          properties: {
            capability: {
              type: "string",
              enum: ["asr", "tts"],
              description: "Optional sound capability filter.",
            },
          },
        },
      },
      examples: [
        { title: "All sound models", payload: {} },
        { title: "ASR models", payload: { capability: "asr" } },
        { title: "TTS models", payload: { capability: "tts" } },
      ],
      execute: async ({ context, input }: { context: PluginContext; input: JsonValue }) => {
        try {
          const capability = normalize_models_capability(input);
          const result = normalize_sound_models(
            await this.sound_ai.catalog().then((catalog) => catalog.all()) as unknown as SoundPluginModel[],
            capability,
          );
          return {
            success: true,
            data: result as unknown as JsonObject,
            message: "sound models listed",
          };
        } catch (error) {
          const message = describe_error(error);
          return { success: false, error: message, message };
        }
      },
    }),
    asr: create_action({
      description:
        "Transcribe audio with a FED ASR model. Local audio paths are converted to data URLs before the FED call.",
      input_schema: {
        zod: SOUND_ASR_INPUT_SCHEMA,
        json_schema: {
          type: "object",
          additionalProperties: true,
          properties: {
            model: { type: "string", description: "FED model ID supporting ASR." },
            audio_path: { type: "string", description: "Absolute or project-relative local audio path." },
            url: { type: "string", description: "Remote audio URL." },
            data_url: { type: "string", description: "Audio data URL." },
            language: { type: "string", description: "Optional language hint." },
            media_type: { type: "string", description: "Optional audio MIME type." },
            filename: { type: "string", description: "Optional original file name." },
          },
        },
      },
      examples: [
        { title: "Local audio", payload: { model: "asr-model-id", audio_path: "./input.wav" } },
        { title: "Remote audio", payload: { model: "asr-model-id", url: "https://example.com/audio.mp3" } },
      ],
      execute: async ({ context, input }: { context: PluginContext; input: JsonValue }) => {
        try {
          const result = await this.transcribe(context, normalize_asr_payload(input));
          return {
            success: true,
            data: result as unknown as JsonObject,
            message: "audio transcribed",
          };
        } catch (error) {
          const message = describe_error(error);
          return { success: false, error: message, message };
        }
      },
    }),
    tts: create_action({
      description:
        "Synthesize speech with a FED TTS model and return an AI SDK UIMessage containing audio.",
      input_schema: {
        zod: SOUND_TTS_INPUT_SCHEMA,
        json_schema: {
          type: "object",
          additionalProperties: true,
          required: ["text"],
          properties: {
            model: { type: "string", description: "FED model ID supporting TTS." },
            text: { type: "string", description: "Text to synthesize." },
            language: { type: "string", description: "Optional language hint." },
            voice: { type: "string", description: "Optional voice ID." },
            format: { type: "string", description: "Optional audio format." },
            speed: { type: "number", description: "Optional speech speed." },
            instructions: { type: "string", description: "Optional voice style instructions." },
          },
        },
      },
      examples: [
        { title: "Default voice", payload: { model: "tts-model-id", text: "Hello, world" } },
        {
          title: "Specific voice",
          payload: { model: "tts-model-id", text: "Welcome back", voice: "alloy", format: "mp3" },
        },
      ],
      execute: async ({ context, input }: { context: PluginContext; input: JsonValue }) => {
        try {
          const result = await this.synthesize(context, normalize_tts_payload(input));
          return {
            success: true,
            message: "speech synthesized",
            messages: [{
              role: "assistant" as const,
              parts: result.parts,
            }],
          };
        } catch (error) {
          const message = describe_error(error);
          return { success: false, error: message, message };
        }
      },
    }),
  };
}
