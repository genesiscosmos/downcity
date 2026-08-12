/**
 * 本地 Embassy 用户会话读取器。
 *
 * 本模块只消费 `downcity.config` 的既有加密结构并创建 Federation User 客户端；
 * 登录、退出、选择 Federation 与会话写入仍由应用宿主负责。
 */

import { Embassy, type EmbassyUser } from "@downcity/federation";
import type { AgentModel } from "@downcity/agent";
import type { LocalConfigRepository } from "@/local/store/LocalConfigRepository.js";

const default_federation_url = "https://base.downcity.ai";

/** 本地持久化的最小 Embassy User Session。 */
interface LocalEmbassyUserSession {
  /** Session 所属 Federation URL。 */
  federation_url: string;
  /** Federation 签发的用户访问 Token。 */
  user_token: string;
}

/** Downcity 本地配置中与 User Session 有关的最小投影。 */
interface LocalDowncityConfig {
  /** 当前应用选择的 Federation URL。 */
  selected_federation_url?: string;
  /** 按规范化 Federation URL 索引的 User Session。 */
  sessions?: Record<string, LocalEmbassyUserSession>;
}

/** 从统一本地配置解析 Embassy 用户能力。 */
export class LocalEmbassySession {
  constructor(private readonly config_repository: LocalConfigRepository) {}

  /** 按持久化 Session 创建一个可供 Agent 使用的模型。 */
  async create_model(model_id_input: string, env: NodeJS.ProcessEnv = process.env): Promise<AgentModel> {
    const model_id = String(model_id_input || "").trim();
    if (!model_id) throw new Error("model_id is required");
    const user = this.create_user(env);
    const catalog = await user.ai.catalog();
    const model = catalog.get(model_id);
    if (!model || !is_agent_model(model.modalities)) {
      throw new Error(`Agent execution model not found in Federation: ${model_id}`);
    }
    return model;
  }

  /** 创建惰性 Agent 模型；首次执行时才访问 Federation 模型目录。 */
  create_agent_model(model_id_input: string, env: NodeJS.ProcessEnv = process.env): AgentModel {
    const model_id = String(model_id_input || "").trim();
    if (!model_id) throw new Error("model_id is required");
    return new LazyLocalAgentModel(
      model_id,
      async () => await this.create_model(model_id, env),
    );
  }

  /** 创建当前有效 Embassy User；显式环境优先于持久化 Session。 */
  create_user(env: NodeJS.ProcessEnv = process.env): EmbassyUser {
    const config = this.config_repository.get_secure_setting<LocalDowncityConfig>("downcity.config") ?? {};
    const selected_url = normalize_federation_url(
      read_string(env.DOWNCITY_FEDERATION_URL)
      || read_string(config.selected_federation_url)
      || default_federation_url,
    );
    const session = config.sessions?.[selected_url];
    const user_token = read_string(env.DOWNCITY_USER_TOKEN) || read_string(session?.user_token);
    if (!user_token) {
      throw new Error("Federation user token is required. Run `city federation login` first.");
    }
    return new Embassy({ federation_url: selected_url, user_token }).user;
  }
}

type LanguageModelV3 = Extract<AgentModel, { readonly specificationVersion: "v3" }>;

/** 只在模型真正执行时解析 Federation CityModel。 */
class LazyLocalAgentModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "downcity";
  readonly supportedUrls: Record<string, RegExp[]> = {};
  readonly modelId: string;

  /** 已解析模型的稳定 Promise。 */
  private model_promise?: Promise<LanguageModelV3>;

  constructor(
    model_id: string,
    private readonly resolve_model: () => Promise<AgentModel>,
  ) {
    this.modelId = model_id;
  }

  /** 延迟执行非流式调用。 */
  async doGenerate(options: Parameters<LanguageModelV3["doGenerate"]>[0]) {
    return await (await this.model()).doGenerate(options);
  }

  /** 延迟执行流式调用。 */
  async doStream(options: Parameters<LanguageModelV3["doStream"]>[0]) {
    return await (await this.model()).doStream(options);
  }

  /** 首次调用时解析并缓存真正的 LanguageModelV3。 */
  private async model(): Promise<LanguageModelV3> {
    this.model_promise ??= this.resolve_model().then((model) => {
      if (
        !model
        || typeof model !== "object"
        || !("specificationVersion" in model)
        || model.specificationVersion !== "v3"
      ) {
        throw new Error(`Federation model does not implement LanguageModelV3: ${this.modelId}`);
      }
      return model as LanguageModelV3;
    });
    return await this.model_promise;
  }
}

/** 判断模型目录项是否能作为 Agent 的文本执行模型。 */
function is_agent_model(modalities: readonly string[]): boolean {
  return modalities.some((modality) => ["text", "stream", "openai"].includes(modality));
}

/** 规范化 Federation URL，并保留现有本地地址默认端口行为。 */
function normalize_federation_url(value: string): string {
  const raw = read_string(value);
  if (!raw) return default_federation_url;
  const has_protocol = /^[a-z][a-z\d+.-]*:\/\//iu.test(raw);
  const is_local = raw.startsWith("localhost") || /^\d+\.\d+\.\d+\.\d+/u.test(raw);
  const url = new URL(has_protocol ? raw : `${is_local ? "http" : "https"}://${raw}`);
  if (!url.port && (url.hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/u.test(url.hostname))) {
    url.port = "43127";
  }
  return url.toString().replace(/\/+$/u, "");
}

/** 读取可选字符串字段。 */
function read_string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
