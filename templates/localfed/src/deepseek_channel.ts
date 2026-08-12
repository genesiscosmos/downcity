/**
 * Local Federation 的 DeepSeek 文本模型通道。
 *
 * 本地模板直接从进程环境读取密钥，让复制 `.env.example` 后即可运行；
 * 正式部署应通过 Federation Env 管理运行时密钥。
 */

import { createDeepSeek } from "@ai-sdk/deepseek";
import {
  AIChannel,
  type AIChannelStreamInput,
  type LanguageModelV3StreamResult,
} from "@downcity/federation";

/** 将 DeepSeek 的 AI SDK 模型接入 Federation 标准流。 */
export class DeepSeekChannel extends AIChannel {
  constructor() {
    super({
      id: "deepseek",
      base_url: "https://api.deepseek.com/v1",
      ai_sdk_provider_id: "deepseek",
    });
  }

  protected async stream(
    input: AIChannelStreamInput,
  ): Promise<LanguageModelV3StreamResult> {
    const api_key = process.env.DEEPSEEK_API_KEY?.trim();
    if (!api_key) {
      throw new Error("请在 templates/localfed/.env 中配置 DEEPSEEK_API_KEY");
    }

    const deepseek = createDeepSeek({
      apiKey: api_key,
      baseURL: this.base_url,
    });
    return deepseek(input.model.upstream_model).doStream(input.call);
  }
}
