/**
 * Sound capability：City 自己拥有的语音识别与语音合成能力。
 *
 * 关键点（中文）
 * - 向模型暴露三个一等工具：`sound_models`、`asr`、`tts`。
 * - 语音 AI 来自 City 持有的 Embassy；本地音频读取以当前 Workspace 为根。
 * - TTS 结果为已落盘的本地音频 Session 消息，由执行器并入当前回复。
 * - 另提供程序化动作 `transcribe`，供 chat 插件做入站音频自动转写；
 *   该动作不进入模型工具清单，模型侧只看到 `asr`。
 */

import { z } from "zod";
import type { ActionResult } from "@downcity/agent";
import type { PluginJsonObject, PluginJsonValue } from "@/plugin/index.js";
import type {
  CityCapability,
  CityCapabilityContext,
  CityCapabilityTool,
} from "@/capabilities/types/CityCapability.js";
import type {
  SoundAiService,
  SoundAsrResult,
  SoundCapabilityKind,
  SoundModel,
  SoundTtsResult,
} from "@/capabilities/sound/types/Sound.js";
import {
  normalize_asr_input,
  normalize_asr_result,
  normalize_models_input,
  normalize_sound_models,
  normalize_tts_input,
  normalize_tts_result,
  resolve_asr_input,
} from "@/capabilities/sound/runtime/SoundProtocol.js";

const MODELS_INPUT_SCHEMA = z.object({
  capability: z.enum(["asr", "tts"]).optional(),
}).passthrough();

const ASR_INPUT_SCHEMA = z.object({
  model: z.string().optional(),
  audio_path: z.string().optional(),
  url: z.string().optional(),
  data_url: z.string().optional(),
  language: z.string().optional(),
  media_type: z.string().optional(),
  filename: z.string().optional(),
  provider_options: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const TTS_INPUT_SCHEMA = z.object({
  model: z.string().optional(),
  text: z.string(),
  language: z.string().optional(),
  voice: z.string().optional(),
  format: z.string().optional(),
  speed: z.number().optional(),
  instructions: z.string().optional(),
  provider_options: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

/** 从 City 注入的 Embassy 获取语音 AI 服务。 */
function require_sound_ai(context: CityCapabilityContext): SoundAiService {
  const service = context.embassy?.user.ai;
  if (!service) throw new Error("sound capability requires a City Embassy user AI service");
  return {
    catalog: async () => await service.catalog(),
    asr: async (input) => await service.asr(input as never),
    tts: async (input) => await service.tts(input as never),
  };
}

/** 读取全部语音可用模型。 */
async function list_models(context: CityCapabilityContext): Promise<SoundModel[]> {
  return await require_sound_ai(context)
    .catalog()
    .then((catalog) => catalog.all()) as unknown as SoundModel[];
}

/**
 * 解析本次调用使用的语音模型。
 *
 * 关键点（中文）
 * - 显式 `model` 永远优先。
 * - 未指定时取模型目录中第一个支持该能力的模型；没有则明确失败，不猜具体型号。
 */
function resolve_model_id(
  context: CityCapabilityContext,
  capability: SoundCapabilityKind,
  input_model: unknown,
  models: SoundModel[],
): string {
  const explicit = typeof input_model === "string" ? input_model.trim() : "";
  if (explicit) return explicit;
  const fallback = normalize_sound_models(models, capability).items[0]?.id;
  if (fallback) return fallback;
  throw new TypeError(
    `no ${capability} model is available; call sound_models first and pass model explicitly`,
  );
}

/** 执行一次语音识别。 */
async function transcribe(
  context: CityCapabilityContext,
  payload: PluginJsonValue | undefined,
): Promise<SoundAsrResult> {
  const input = normalize_asr_input(payload);
  const model = resolve_model_id(context, "asr", input.model, await list_models(context));
  const resolved = await resolve_asr_input({
    workspace_path: context.workspace_path,
    payload: { ...input, model },
  });
  return normalize_asr_result(
    await require_sound_ai(context)
      .asr(resolved as unknown as PluginJsonObject) as unknown as SoundAsrResult,
  );
}

/** 执行一次语音合成。 */
async function synthesize(
  context: CityCapabilityContext,
  payload: PluginJsonValue | undefined,
): Promise<SoundTtsResult> {
  const input = normalize_tts_input(payload);
  const model = resolve_model_id(context, "tts", input.model, await list_models(context));
  const result = await require_sound_ai(context).tts({
    ...input,
    model,
  } as unknown as PluginJsonObject);
  return normalize_tts_result(result as unknown as SoundTtsResult);
}

/** 列出支持 ASR 或 TTS 的模型。 */
const sound_models_tool: CityCapabilityTool = {
  name: "sound_models",
  description: "List models whose modalities include asr or tts. Pass capability to filter the list.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      capability: {
        type: "string",
        enum: ["asr", "tts"],
        description: "Optional sound capability filter.",
      },
    },
  },
  async execute(input, context): Promise<ActionResult> {
    const capability = normalize_models_input(input as PluginJsonValue | undefined);
    return {
      output: normalize_sound_models(await list_models(context), capability),
      messages: [],
    };
  },
};

/** 转写音频。 */
const asr_tool: CityCapabilityTool = {
  name: "asr",
  description:
    "Transcribe audio with a FED ASR model. Local audio paths are converted to data URLs before the call.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      model: { type: "string", description: "FED model id supporting asr." },
      audio_path: {
        type: "string",
        description: "Absolute or Workspace-relative local audio path.",
      },
      url: { type: "string", description: "Remote audio URL." },
      data_url: { type: "string", description: "Audio data URL." },
      language: { type: "string", description: "Optional language hint." },
      media_type: { type: "string", description: "Optional audio MIME type." },
      filename: { type: "string", description: "Optional original file name." },
    },
  },
  async execute(input, context): Promise<ActionResult> {
    return {
      output: await transcribe(context, input as PluginJsonValue | undefined),
      messages: [],
    };
  },
};

/** 合成语音并返回音频。 */
const tts_tool: CityCapabilityTool = {
  name: "tts",
  description:
    "Synthesize speech with a FED TTS model and attach the resulting audio to the assistant reply.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: {
      model: { type: "string", description: "FED model id supporting tts." },
      text: { type: "string", description: "Text to synthesize." },
      language: { type: "string", description: "Optional language hint." },
      voice: { type: "string", description: "Optional voice id." },
      format: { type: "string", description: "Optional audio format." },
      speed: { type: "number", description: "Optional speech speed." },
      instructions: { type: "string", description: "Optional voice style instructions." },
    },
  },
  async execute(input, context): Promise<ActionResult> {
    const result = await synthesize(context, input as PluginJsonValue | undefined);
    return {
      output: { text: "speech synthesized" },
      messages: [{ role: "agent", parts: result.parts }],
    };
  },
};

/** City 内置语音能力。 */
export function create_sound_capability(): CityCapability {
  return {
    id: "sound",
    tools: [sound_models_tool, asr_tool, tts_tool],
    system(): string {
      return [
        "# Sound capability",
        "",
        "Use this capability for speech recognition (ASR) and text-to-speech (TTS).",
        "Do not call `tts` for ordinary text replies unless the user explicitly requests audio.",
        "",
        "## Tools",
        "",
        "- `sound_models`: list FED models whose modalities include `asr` or `tts`.",
        "  Pass `capability` to filter the list.",
        "- `asr`: transcribe audio. Provide exactly one of `audio_path`, `url`, or `data_url`.",
        "- `tts`: synthesize speech from required `text` and return an audio file part.",
        "",
        "## Model selection",
        "",
        "Pass the selected FED model id in `model`. When it is omitted, the first available model",
        "supporting that capability is used, so call `sound_models` first when the choice matters.",
        "Never use an ASR-only model for TTS or a TTS-only model for ASR.",
        "",
        "## Results",
        "",
        "ASR returns transcript text and may include timed segments, language, and duration.",
        "TTS returns a Session message whose audio file part already points to a local file, and that",
        "part is attached to the assistant response.",
        "",
        "Never invent a transcript or audio result when a FED call fails.",
      ].join("\n");
    },
    async invoke(action, input, context): Promise<unknown> {
      if (action !== "transcribe") {
        throw new Error(`Unknown sound capability action: ${action}`);
      }
      return await transcribe(context, input as PluginJsonValue | undefined);
    },
  };
}
