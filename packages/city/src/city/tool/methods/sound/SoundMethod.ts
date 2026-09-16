/**
 * city tool `sound` method：City 自己拥有的语音识别与合成能力。
 *
 * 关键点（中文）
 * - 三个动作：`models`、`asr`、`tts`；读取模型是 read，转写与合成声明为 write。
 * - 语音 AI 来自 City 持有的 Embassy；本地音频读取以当前 Workspace 为根。
 * - `tts` 只返回已落盘的本地音频路径，不注入 Agent 消息。
 * - 另提供程序化动作 `transcribe`，供 chat 插件做入站音频自动转写；
 *   该动作不进入模型工具清单，模型侧只看到 `asr`。
 */

import type { PluginJsonObject, PluginJsonValue } from "@/plugin/index.js";
import type { CityToolArgSpec, CityToolContext } from "@/city/types/CityTool.js";
import type {
  SoundAiService,
  SoundAsrResult,
  SoundModel,
  SoundTtsOutput,
} from "@/city/tool/methods/sound/types/Sound.js";
import {
  normalize_asr_input,
  normalize_asr_result,
  normalize_models_input,
  normalize_sound_models,
  normalize_tts_input,
  normalize_tts_result,
  resolve_asr_input,
} from "@/city/tool/methods/sound/runtime/SoundProtocol.js";
import {
  CityAction,
  string_arg,
  type CityToolArgs,
} from "@/city/tool/CityAction.js";
import { CityMethod } from "@/city/tool/CityMethod.js";

/** 从 City 注入的 Embassy 获取语音 AI 服务。 */
function require_sound_ai(context: CityToolContext): SoundAiService {
  const service = context.embassy?.user.ai;
  if (!service) throw new Error("sound method requires a City Embassy user AI service");
  return {
    catalog: async () => await service.catalog(),
    asr: async (input) => await service.asr(input as never),
    tts: async (input) => await service.tts(input as never),
  };
}

/** 读取全部语音可用模型。 */
async function list_models(context: CityToolContext): Promise<SoundModel[]> {
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
  context: CityToolContext,
  capability: "asr" | "tts",
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
export async function transcribe(
  context: CityToolContext,
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
  context: CityToolContext,
  payload: PluginJsonValue | undefined,
): Promise<SoundTtsOutput> {
  const input = normalize_tts_input(payload);
  const model = resolve_model_id(context, "tts", input.model, await list_models(context));
  const result = await require_sound_ai(context).tts({
    ...input,
    model,
  } as unknown as PluginJsonObject);
  const normalized = normalize_tts_result(result as never);
  return {
    files: normalized.parts.flatMap((part) =>
      part.type === "file" && part.url.trim() ? [part.url.trim()] : []),
  };
}

/** 列出支持 ASR 或 TTS 的模型。 */
class SoundModelsAction extends CityAction {
  readonly action = "models";
  readonly summary = "List models whose modalities include asr or tts.";
  readonly returns = "items(id, name, description, modalities, tags, meta)";
  readonly args: readonly CityToolArgSpec[] = [
    {
      name: "capability",
      type: "string",
      required: false,
      description: "Filter by capability: asr or tts.",
    },
  ];

  protected async run(
    args: CityToolArgs,
    context: CityToolContext,
  ): Promise<ReturnType<typeof normalize_sound_models>> {
    const capability = normalize_models_input(args as PluginJsonValue | undefined);
    return normalize_sound_models(await list_models(context), capability);
  }
}

/** 转写音频。 */
class AsrAction extends CityAction {
  readonly action = "asr";
  readonly summary =
    "Transcribe audio. Provide exactly one of audio_path, url, or data_url.";
  readonly returns = "text, segments, language, durationInSeconds";
  readonly capability = "write";
  readonly args: readonly CityToolArgSpec[] = [
    { name: "model", type: "string", required: false, description: "Model id supporting asr." },
    {
      name: "audio_path",
      type: "string",
      required: false,
      description: "Absolute or Workspace-relative local audio path.",
    },
    { name: "url", type: "string", required: false, description: "Remote audio URL." },
    { name: "data_url", type: "string", required: false, description: "Audio data URL." },
    { name: "language", type: "string", required: false, description: "Optional language hint." },
    { name: "media_type", type: "string", required: false, description: "Optional audio MIME type." },
    { name: "filename", type: "string", required: false, description: "Optional original file name." },
  ];

  protected async run(args: CityToolArgs, context: CityToolContext): Promise<SoundAsrResult> {
    return await transcribe(context, args as PluginJsonValue | undefined);
  }
}

/** 合成语音并返回本地音频路径。 */
class TtsAction extends CityAction {
  readonly action = "tts";
  readonly summary = "Synthesize speech and return the local audio file path.";
  readonly returns = "files(local absolute paths)";
  readonly capability = "write";
  readonly args: readonly CityToolArgSpec[] = [
    string_arg("text", "Text to synthesize."),
    { name: "model", type: "string", required: false, description: "Model id supporting tts." },
    { name: "language", type: "string", required: false, description: "Optional language hint." },
    { name: "voice", type: "string", required: false, description: "Optional voice id." },
    { name: "format", type: "string", required: false, description: "Optional audio format." },
    { name: "speed", type: "number", required: false, description: "Optional speech speed." },
    { name: "instructions", type: "string", required: false, description: "Optional voice style." },
  ];

  protected async run(args: CityToolArgs, context: CityToolContext): Promise<SoundTtsOutput> {
    return await synthesize(context, args as PluginJsonValue | undefined);
  }
}

/** `sound` method。 */
export class SoundMethod extends CityMethod {
  readonly method = "sound";
  readonly summary = "Transcribe audio and synthesize speech through City-owned models.";
  protected readonly actions = [
    new SoundModelsAction(),
    new AsrAction(),
    new TtsAction(),
  ];

  system(): string {
    return [
      "# Sound method",
      "",
      "Use this method for speech recognition (ASR) and text-to-speech (TTS).",
      "Do not call `tts` for ordinary text replies unless the user explicitly requests audio.",
      "",
      "## Actions",
      "",
      "- `models`: list models whose modalities include `asr` or `tts`.",
      "  Pass `capability` to filter the list.",
      "- `asr`: transcribe audio. Provide exactly one of `audio_path`, `url`, or `data_url`.",
      "  Returns transcript text and may include timed segments, language, and duration.",
      "- `tts`: synthesize speech from required `text` and return `files` with the local audio path.",
      "",
      "## Model selection",
      "",
      "Pass the selected model id in `model`. When it is omitted, the first available model",
      "supporting that capability is used, so call `models` first when the choice matters.",
      "Never use an ASR-only model for TTS or a TTS-only model for ASR.",
      "",
      "Never invent a transcript or audio result when a call fails.",
    ].join("\n");
  }

  async invoke(action: string, input: unknown, context: CityToolContext): Promise<unknown> {
    if (action !== "transcribe") {
      throw new Error(`Unknown sound method action: ${action}`);
    }
    return await transcribe(context, input as PluginJsonValue | undefined);
  }
}
