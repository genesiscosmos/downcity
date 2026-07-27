/**
 * Downcity edge Federation 示例入口。
 *
 * 关键点（中文）
 * - 这是一个标准的 Federation edge 项目示例，部署入口统一走 `city deploy`。
 * - 业务 env、admin key、provider key 统一由 Federation 自己管理。
 * - Worker 只负责承接 Edge runtime 能力，例如 D1 与 HTTP request。
 * - 装配过程平铺在本文件，不再通过 compose_city 函数包裹。
 */

import { drizzle } from "drizzle-orm/d1";
import { Federation, AIService } from "@downcity/city";
import type { AIBillInput } from "@downcity/city";
import {
  AccountsService,
  CreditsService,
  PaymentService,
  UsageService,
  creemPaymentProvider,
  dodoPaymentProvider,
  githubAccountsProvider,
  googleAccountsProvider,
  stripePaymentProvider,
  wechatAccountsProvider,
  waffoPaymentProvider,
} from "@downcity/services";
import {
  GeminiImageChannel,
  LuchiImageChannel,
  OpenAIImageChannel,
} from "./image-channel.js";
import { DeepSeekChannel } from "./deepseek-channel.js";

const CHAT_REQUEST_COST_CREDITS = 10_000;
const IMAGE_COST_CREDITS = 50_000;
const WORKER_VERSION = "0.0.1";

export interface Env {
  DB: D1Database;
}

let federation_promise: Promise<Federation> | undefined;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Max-Age": "86400",
};

function get_federation(env: Env): Promise<Federation> {
  if (!federation_promise) {
    federation_promise = init_federation(env);
  }
  return federation_promise;
}

async function init_federation(env: Env): Promise<Federation> {
  const db = drizzle(env.DB);

  // 关键说明（中文）
  // Payment 在 paid 后通过 CreditsService 发放额度，AI 通过 CreditsService 扣费。
  const federation = new Federation({ db });

  federation.use(new AccountsService({
    providers: [
      githubAccountsProvider(),
      googleAccountsProvider(),
      wechatAccountsProvider(),
    ],
  }));

  const credits = new CreditsService();
  federation.use(credits);

  federation.use(new PaymentService({
    on_paid: async (record) => {
      await credits.topup({
        card: { kind: "primary", user_id: record.user_id },
        credits: record.credits,
        source: "payment",
        ref: record.payment_id,
        idempotency_key: `payment:${record.payment_id}`,
      });
    },
    providers: [
      stripePaymentProvider(),
      creemPaymentProvider(),
      dodoPaymentProvider(),
      waffoPaymentProvider(),
    ],
  }));

  federation.use(new UsageService({ record_errors: true }));

  const deepseek_channel = new DeepSeekChannel();
  const luchi_image_channel = new LuchiImageChannel({
    id: "luchi-image",
    env_key: "LUCHI_IMAGE_API_KEY",
  });
  const image_302_channel = new OpenAIImageChannel({
    id: "302-image",
    env_key: "AI302_API_KEY",
    base_url: "https://api.302.ai/v1",
    provider_options_key: "302ai",
  });
  const openai_image_channel = new OpenAIImageChannel({
    id: "openai-image",
    env_key: "OPENAI_API_KEY",
    base_url: "https://api.openai.com/v1",
  });
  const gemini_image_channel = new GeminiImageChannel({
    id: "gemini-image",
    env_key: "GEMINI_API_KEY",
  });

  const ai = new AIService({ credits });
  ai.use([
    deepseek_channel.model({
      id: "deepseek-v4-flash",
      upstream_model: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      description: "DeepSeek OpenAI-compatible text model",
      tags: ["deepseek", "text"],
      bill: (input) => bill_ai_request(input, CHAT_REQUEST_COST_CREDITS),
    }),
    deepseek_channel.model({
      id: "deepseek-v4-pro",
      upstream_model: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      description: "DeepSeek OpenAI-compatible text model",
      tags: ["deepseek", "text"],
      bill: (input) => bill_ai_request(input, CHAT_REQUEST_COST_CREDITS),
    }),
    luchi_image_channel.model({
      id: "luchi-gpt-image-2",
      upstream_model: "gpt-image-2",
      name: "Luchi GPT Image 2",
      description: "Luchi async image generation model",
      tags: ["luchi", "image"],
      meta: {
        upstream_model: "gpt-image-2",
      },
      bill: (input) => bill_ai_request(input, IMAGE_COST_CREDITS),
    }),
    luchi_image_channel.model({
      id: "luchi-gpt-image-1",
      upstream_model: "gpt-image-1",
      name: "Luchi GPT Image 1",
      description: "Luchi async image generation model",
      tags: ["luchi", "image"],
      meta: {
        upstream_model: "gpt-image-1",
      },
      bill: (input) => bill_ai_request(input, IMAGE_COST_CREDITS),
    }),
    image_302_channel.model({
      id: "302-gpt-image-1",
      upstream_model: "gpt-image-1",
      name: "302.ai GPT Image 1",
      description: "302.ai OpenAI-compatible image generation model",
      tags: ["302.ai", "image"],
      meta: { upstream_model: "gpt-image-1" },
      bill: (input) => bill_ai_request(input, IMAGE_COST_CREDITS),
    }),
    openai_image_channel.model({
      id: "openai-gpt-image-1",
      upstream_model: "gpt-image-1",
      name: "OpenAI GPT Image 1",
      description: "OpenAI image generation model",
      tags: ["openai", "image"],
      meta: { upstream_model: "gpt-image-1" },
      bill: (input) => bill_ai_request(input, IMAGE_COST_CREDITS),
    }),
    gemini_image_channel.model({
      id: "gemini-2.5-flash-image",
      upstream_model: "gemini-2.5-flash-image",
      name: "Gemini 2.5 Flash Image",
      description: "Gemini generateContent image model",
      tags: ["gemini", "image"],
      meta: { upstream_model: "gemini-2.5-flash-image" },
      bill: (input) => bill_ai_request(input, IMAGE_COST_CREDITS),
    }),
  ]);
  federation.use(ai);

  await federation.health();

  return federation;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return withCors(new Response(`Downcity is up and ready. worker=${WORKER_VERSION}`, {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }));
    }

    const federation = await get_federation(env);
    if (request.method === "GET" && url.pathname === "/health") {
      const health = await federation.health();
      return withCors(Response.json({
        ...health,
        version: WORKER_VERSION,
      }));
    }
    const response = await federation.fetch(request, { execution: ctx });
    return withCors(response);
  },
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * 生成一次 AI 调用的账单行。
 */
function bill_ai_request(input: AIBillInput, credits: number) {
  const mode = String(input.metering?.metadata?.mode ?? "request");
  return {
    user_id: read_bill_user_id(input.output),
    credits,
    note: `AI ${mode}`,
    ref: read_bill_ref(input.output),
    metadata: {
      service_id: "ai",
      action_id: mode,
      model_id: input.metering?.model_id ?? input.model.id,
      channel_id: input.metering?.channel_id,
    },
  };
}

/**
 * 从输出对象中提取账单引用。
 */
function read_bill_ref(output: unknown): string | undefined {
  if (!output || typeof output !== "object" || Array.isArray(output)) return undefined;
  const record = output as Record<string, unknown>;
  const ref = record.job_id ?? record.id ?? record.ref;
  return typeof ref === "string" && ref.trim() ? ref.trim() : undefined;
}

/**
 * 从输出对象中提取扣费用户 ID。
 */
function read_bill_user_id(output: unknown): string | undefined {
  if (!output || typeof output !== "object" || Array.isArray(output)) return undefined;
  const record = output as Record<string, unknown>;
  const metadata = record.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const user_id = (metadata as Record<string, unknown>).user_id;
  return typeof user_id === "string" && user_id.trim() ? user_id.trim() : undefined;
}
