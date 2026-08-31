/**
 * Local Federation 的 DeepSeek 文本模型通道。
 *
 * 本地模板直接从进程环境读取密钥，让复制 `.env.example` 后即可运行；
 * 正式部署应通过 Federation Env 管理运行时密钥。
 */

import {
  AIChannel,
  type AIChannelStreamInput,
  type AIChannelStreamResult,
  stream_openai_compatible_model,
} from "@downcity/federation";

/** 将 DeepSeek 的 OpenAI-compatible API 接入 Federation 标准流。 */
export class DeepSeekChannel extends AIChannel {
  constructor() {
    super({
      id: "deepseek",
      base_url: "https://api.deepseek.com/v1",
    });
  }

  protected async stream(
    input: AIChannelStreamInput,
  ): Promise<AIChannelStreamResult> {
    const api_key = process.env.DEEPSEEK_API_KEY?.trim();
    if (!api_key) {
      throw new Error("请在 templates/localfed/.env 中配置 DEEPSEEK_API_KEY");
    }

    return stream_openai_compatible_model(input, {
      api_key,
      base_url: this.base_url ?? "https://api.deepseek.com/v1",
    });
  }
}
