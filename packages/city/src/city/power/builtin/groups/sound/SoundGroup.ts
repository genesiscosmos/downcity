/**
 * city power `sound` 动作组：City 自己拥有的语音识别与合成能力。
 *
 * 关键点（中文）
 * - 三个动作：`sound.models`、`sound.asr`、`sound.tts`；读模型是 read，转写与合成是 write。
 * - 语音 AI 经 Town 统一模型 ID 路由；本地音频读取以当前 Workspace 为根。
 * - `tts` 只返回已落盘的本地音频路径，不注入 Agent 消息。
 * - `asr` 同时服务模型调用与其它 power 的程序化调用（例如 chat 入站音频自动转写），
 *   因此不再需要单独的非模型侧动作或 `invoke` 入口。
 */

import { z } from "zod";
import type { PowerJsonValue } from "@/power/index.js";
import type { PowerTown } from "@/power/types/PowerTown.js";
import type { TownModelEntry, TownModelList } from "@/town/types/TownModels.js";
import type { CityPowerContext } from "@/city/types/CityPowerContext.js";
import type {
  SoundAsrResult,
  SoundModel,
  SoundTtsOutput,
} from "@/city/power/builtin/groups/sound/types/Sound.js";
import {
  normalize_asr_input,
  normalize_asr_result,
  normalize_models_input,
  normalize_sound_models,
  normalize_tts_input,
  normalize_tts_result,
  resolve_asr_input,
} from "@/city/power/builtin/groups/sound/runtime/SoundProtocol.js";
import { localize_sound_result } from "./runtime/SoundResultStorage.js";
import { CityAction, CityActionError } from "@/city/power/builtin/CityAction.js";
import { CityActionGroup } from "@/city/power/builtin/CityActionGroup.js";

/** 语音动作仅使用 Town，不能隐式切换 Downtown 或账户。 */
function require_sound_models(context: CityPowerContext): PowerTown["models"] {
  if (!context.town) {
    throw new CityActionError({ code: "unsupported_action", message: "sound actions require City Town model routing." });
  }
  return context.town.models;
}

/** 只读取实际支持语音能力的模型，保留每个来源失败状态。 */
async function list_models(context: CityPowerContext): Promise<TownModelList> {
  const catalog = await require_sound_models(context).list({ signal: context.abort_signal });
  return { ...catalog, items: catalog.items.filter((entry) => entry.modalities.includes("asr") || entry.modalities.includes("tts")) };
}

/**
 * 解析本次调用使用的语音模型。
 *
 * 关键点（中文）
 * - 显式 `model` 永远优先。
 * - 未指定时仅在恰好一个可用候选时选择；多个候选要求明确模型，不按目录顺序切换计费来源。
 */
function resolve_model(
  capability: "asr" | "tts",
  input_model: unknown,
  catalog: TownModelList,
): TownModelEntry {
  const explicit = typeof input_model === "string" ? input_model.trim() : "";
  const candidates = catalog.items.filter((entry) => entry.modalities.includes(capability));
  if (explicit) {
    const selected = candidates.find((entry) => entry.model_id === explicit);
    if (selected) return selected;
    throw new CityActionError({ code: "unsupported_action", message: `the selected ${capability} model is unavailable; select a model from sound.models.` });
  }
  // 来源故障时目录不完整，不能把剩余一项解释为用户已选定的唯一计费来源。
  if (catalog.sources.some((source) => source.status !== "available")) {
    throw new CityActionError({ code: "invalid_args", message: `some model sources are unavailable; pass an explicit ${capability} model from sound.models.` });
  }
  if (candidates.length === 1) return candidates[0]!;
  throw new CityActionError({
    code: candidates.length ? "invalid_args" : "unsupported_action",
    message: candidates.length
      ? `multiple ${capability} models are available; pass a model ID from sound.models explicitly.`
      : `no ${capability} model is available; call sound.models first.`,
  });
}

/** 执行一次语音识别。 */
async function transcribe_audio(
  context: CityPowerContext,
  payload: PowerJsonValue | undefined,
): Promise<SoundAsrResult> {
  const input = normalize_asr_input(payload);
  const selected = resolve_model("asr", input.model, await list_models(context));
  const resolved = await resolve_asr_input({
    workspace_path: context.workspace_path,
    payload: { ...input, model: selected.model_id },
  });
  const { model: _model, ...business_input } = resolved;
  return normalize_asr_result(
    await require_sound_models(context).asr({
      model_id: selected.model_id, binding_id: selected.binding_id,
      input: business_input, signal: context.abort_signal,
    }),
  );
}

/** 执行一次语音合成。 */
async function synthesize_speech(
  context: CityPowerContext,
  payload: PowerJsonValue | undefined,
): Promise<SoundTtsOutput> {
  const input = normalize_tts_input(payload);
  const selected = resolve_model("tts", input.model, await list_models(context));
  const { model: _model, ...business_input } = input;
  const result = await require_sound_models(context).tts({
    model_id: selected.model_id, binding_id: selected.binding_id,
    input: business_input, signal: context.abort_signal,
  });
  return localize_sound_result(context, normalize_tts_result(result));
}

/** `sound.models` 的输入。 */
const sound_models_input = z.strictObject({
  /** Filter by capability: asr or tts. */
  capability: z
    .enum(["asr", "tts"])
    .optional()
    .describe("Filter by capability: asr or tts."),
});

/** 列出支持 ASR 或 TTS 的模型。 */
class SoundModelsAction extends CityAction<z.infer<typeof sound_models_input>> {
  readonly action = "models";
  readonly description = "List models whose modalities include asr or tts.";
  readonly returns = "items(id, name, description, modalities, tags, meta)";
  readonly args_schema = sound_models_input;

  protected async run(
    args: z.infer<typeof sound_models_input>,
    context: CityPowerContext,
  ): Promise<ReturnType<typeof normalize_sound_models>> {
    const capability = normalize_models_input(args as PowerJsonValue);
    const catalog = await list_models(context);
    const normalized = normalize_sound_models(catalog.items.map((entry) => ({ ...entry, id: entry.model_id })) as SoundModel[], capability);
    return {
      items: normalized.items.map((item) => {
        const entry = catalog.items.find((entry) => entry.model_id === item.id)!;
        return { ...item, source_id: entry.source_id, source_name: entry.source_name, binding_id: entry.binding_id };
      }),
      sources: catalog.sources,
    };
  }
}

/** `sound.asr` 的输入。 */
const sound_asr_input = z.strictObject({
  /** Model id supporting asr. */
  model: z.string().optional().describe("Model id supporting asr."),
  /** Absolute or Workspace-relative local audio path. */
  audio_path: z
    .string()
    .optional()
    .describe("Absolute or Workspace-relative local audio path."),
  /** Remote audio URL. */
  url: z.string().optional().describe("Remote audio URL."),
  /** Audio data URL. */
  data_url: z.string().optional().describe("Audio data URL."),
  /** Optional language hint. */
  language: z.string().optional().describe("Optional language hint."),
  /** Optional audio MIME type. */
  media_type: z.string().optional().describe("Optional audio MIME type."),
  /** Optional original file name. */
  filename: z.string().optional().describe("Optional original file name."),
});

/** 转写音频。 */
class AsrAction extends CityAction<z.infer<typeof sound_asr_input>> {
  readonly action = "asr";
  readonly description =
    "Transcribe audio. Provide exactly one of audio_path, url, or data_url.";
  readonly returns = "text, segments, language, durationInSeconds";
  readonly access = "write";
  readonly approval = true;
  readonly args_schema = sound_asr_input;

  protected async run(
    args: z.infer<typeof sound_asr_input>,
    context: CityPowerContext,
  ): Promise<SoundAsrResult> {
    return await transcribe_audio(context, args as PowerJsonValue);
  }
}

/** `sound.tts` 的输入。 */
const sound_tts_input = z.strictObject({
  /** Text to synthesize. */
  text: z.string().trim().min(1).describe("Text to synthesize."),
  /** Model id supporting tts. */
  model: z.string().optional().describe("Model id supporting tts."),
  /** Optional language hint. */
  language: z.string().optional().describe("Optional language hint."),
  /** Optional voice id. */
  voice: z.string().optional().describe("Optional voice id."),
  /** Optional audio format. */
  format: z.string().optional().describe("Optional audio format."),
  /** Optional speech speed. */
  speed: z.number().optional().describe("Optional speech speed."),
  /** Optional voice style. */
  instructions: z.string().optional().describe("Optional voice style."),
});

/** 合成语音并返回本地音频路径。 */
class TtsAction extends CityAction<z.infer<typeof sound_tts_input>> {
  readonly action = "tts";
  readonly description = "Synthesize speech and return the local audio file path.";
  readonly returns = "files(local absolute paths)";
  readonly access = "write";
  readonly approval = true;
  readonly args_schema = sound_tts_input;

  protected async run(
    args: z.infer<typeof sound_tts_input>,
    context: CityPowerContext,
  ): Promise<SoundTtsOutput> {
    return await synthesize_speech(context, args as PowerJsonValue);
  }
}

/** `sound` 动作组。 */
export class SoundGroup extends CityActionGroup {
  readonly group = "sound";
  protected readonly actions = [
    new SoundModelsAction(),
    new AsrAction(),
    new TtsAction(),
  ];

  system(): string {
    return [
      "# Sound actions",
      "",
      "Use these actions for speech recognition (ASR) and text-to-speech (TTS).",
      "Do not call `sound.tts` for ordinary text replies unless the user explicitly requests audio.",
      "",
      "## Actions",
      "",
      "- `sound.models`: list models whose modalities include `asr` or `tts`.",
      "  Pass `capability` to filter the list.",
      "- `sound.asr`: transcribe audio. Provide exactly one of `audio_path`, `url`, or `data_url`.",
      "  Returns transcript text and may include timed segments, language, and duration.",
      "- `sound.tts`: synthesize speech from required `text` and return `files` with the local audio path.",
      "",
      "## Model selection",
      "",
      "Pass the unified model id returned by `sound.models` in `model`.",
      "When omitted, a model is selected only if exactly one candidate supports the capability.",
      "If several models are available, choose one explicitly; requests never switch billing sources automatically.",
      "Never use an ASR-only model for TTS or a TTS-only model for ASR.",
      "",
      "Never invent a transcript or audio result when a call fails.",
    ].join("\n");
  }
}
