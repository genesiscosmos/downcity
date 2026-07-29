/**
 * @downcity/city City 客户端类型契约测试。
 */

import type { UIMessage, UIMessageChunk } from "ai";
import type {
  AIBill,
  AIBillInput,
  AIChannelActionInput,
  AIChannelModel,
  AIChannelOptions,
  AIChannelStreamInput,
  AICharge,
  AIChargedResult,
  AIInvoker,
  AIImageCreateResult,
  AIImageResult,
  AIModelDefinition,
  AIModelFallbackMedia,
  AIModelFallbackRule,
  AIModelSpec,
  AIResolvedReasoning,
  AISDKProviderOptions,
  AIServiceOptions,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamResult,
  CityModelDescriptor,
  City,
  Bureau,
  BureauTokenSummary,
  Federation,
  ModelCatalog,
  PaymentMethodHandle,
  UserImageJobCreateResult,
  UserImageJobResult,
  UserModelRef,
  UserPaymentMethod,
  UserProfile,
  UserServiceSummary,
  RegisterBureauTokenInput,
} from "../src/index.js";

// @ts-expect-error 旧计费类型不再从公共入口导出
import type { AIChannelChargeLine } from "../src/index.js";
// @ts-expect-error 语言运行时已经收进 AIModelDefinition.runtime
import type { AIModelLanguageRuntime } from "../src/index.js";
// @ts-expect-error 图片 Channel 结果已统一为 AIImageResult
import type { AIImageChannelResult } from "../src/index.js";
// @ts-expect-error OpenAI Chat 细粒度协议只属于内部 transport
import type { OpenAIChatCompletionRequest } from "../src/index.js";
// @ts-expect-error 上游模型通过 AIChannel 输入显式传递
import { resolve_upstream_model } from "../src/index.js";

/** 公共 AI 类型必须从单一 SDK 入口稳定导出。 */
type PublicAITypeContract = [
  AIChannelOptions,
  AIChannelModel,
  AIChannelStreamInput,
  AIChannelActionInput,
  AIModelSpec,
  AIModelDefinition,
  AIModelFallbackMedia,
  AIModelFallbackRule,
  AIServiceOptions,
  LanguageModelV3,
  AISDKProviderOptions,
  AIResolvedReasoning,
  AICharge,
  AIBill,
  AIBillInput,
  AIChargedResult,
  AIImageCreateResult,
  AIImageResult,
];
declare const public_ai_type_contract: PublicAITypeContract;
void public_ai_type_contract;

declare const provider_stream_call: LanguageModelV3CallOptions;
declare const provider_stream_result: LanguageModelV3StreamResult;
void provider_stream_call;
void provider_stream_result;

declare const city: City;
declare const admin: Bureau;
declare const bureau: Bureau;
declare const federation: Federation;
declare const user_city: City;
declare const admin_city: Bureau;

const ai: AIInvoker = city.ai;

const textResult = ai.text({ model: "gpt-5.4", prompt: "hello" });
const textContract: Promise<UIMessage> = textResult;

const reasoningTextResult = ai.text({
  model: "gpt-5.4",
  prompt: "hello",
  reasoning_effort: "high",
});
const reasoningTextContract: Promise<UIMessage> = reasoningTextResult;
void reasoningTextContract;

const streamResult = ai.stream({ model: "gpt-5.4", prompt: "hello" });
const streamContract: Promise<ReadableStream<UIMessageChunk>> = streamResult;

const imageJobCreateResult = ai.image_create({ model: "image-basic", prompt: "draw" });
const imageJobCreateContract: Promise<UserImageJobCreateResult> = imageJobCreateResult;
void imageJobCreateContract;

const imageJobResult = ai.image_result({ job_id: "img_1" });
const imageJobResultContract: Promise<UserImageJobResult> = imageJobResult;
void imageJobResultContract;

const videoResult = ai.video({ model: "video-basic", prompt: "demo" });
const videoContract: Promise<UIMessage> = videoResult;

const adminServices = admin.listServices();
const adminServicesContract: Promise<UserServiceSummary[]> = adminServices;

const adminModels = admin.listModels();
const adminModelsContract: Promise<CityModelDescriptor[]> = adminModels;

const adminInstruction = admin.instruction();
const adminInstructionContract: Promise<string> = adminInstruction;

const bureau_registration_input: RegisterBureauTokenInput = {
  token_id: "br_1234567890abcdef",
  purpose: "type contract test",
  token_hash: "1234567890123456789012345678901234567890123",
};
const bureau_registration: Promise<BureauTokenSummary> = admin.bureaus.register(
  bureau_registration_input,
);
void bureau_registration;

const federation_bureaus = admin.bureaus.list();
void federation_bureaus;

const bureau_identity = bureau.identify("ub_header.payload.signature");
void bureau_identity;

const bureau_cities = bureau.cities.list();
const bureau_env = bureau.env.list();
const bureau_tokens = bureau.bureaus.list();
void bureau_cities;
void bureau_env;
void bureau_tokens;

const bureau_get_result: Promise<{ status: string }> = city.get("https://bureau.example.com/reports/status");
const bureau_post_result: Promise<{ report_id: string }> = city.post(
  "https://bureau.example.com/reports/summary",
  { range: "today" },
);
void bureau_get_result;
void bureau_post_result;

const user_profile: Promise<UserProfile | null> = city.user().profile();
void user_profile;

const paymentMethods = city.payment.methods();
const paymentMethodsContract: Promise<UserPaymentMethod[]> = paymentMethods;

const cityPaymentMethodsContract: Promise<UserPaymentMethod[]> = user_city.payment.methods();
const cityAdminServicesContract: Promise<UserServiceSummary[]> = admin_city.listServices();
const cityInstructionContract: Promise<string> = admin_city.instruction();
void cityPaymentMethodsContract;
void cityAdminServicesContract;
void cityInstructionContract;

const paymentMethod: PaymentMethodHandle = city.payment.method("stripe");
const paymentMethodDescribeContract: Promise<UserPaymentMethod> = paymentMethod.describe();
const paymentMethodInvokeContract: Promise<{ checkout_url: string }> = paymentMethod.invoke<{
  checkout_url: string;
}>({
  topup_amount_minor: 500,
  idempotency_key: "order_123",
});
void paymentMethodDescribeContract;
void paymentMethodInvokeContract;

async function testCatalog() {
  const catalog: ModelCatalog = await ai.catalog();
  const m = catalog.get("gpt-5.4");
  const all = catalog.all();
  const t = catalog.forModality("text");
  const reasoning_efforts = m?.reasoning?.efforts;
  const default_reasoning_effort = m?.reasoning?.default_effort;
  const context_window = m?.context_window;
  const price = m?.price;
  void m; void all; void t; void reasoning_efforts; void default_reasoning_effort; void context_window; void price;
}
void testCatalog();

// @ts-expect-error text 返回类型固定为 UIMessage
ai.text<{ text: string }>({ prompt: "hello" });

// @ts-expect-error stream 返回类型固定为 UIMessageChunk stream
ai.stream<ReadableStream<string>>({ prompt: "hello" });

// @ts-expect-error image 已移除，图片生成请使用 image_create / image_result
ai.image({ prompt: "draw" });

// @ts-expect-error video 返回类型固定为 UIMessage
ai.video<{ url: string }>({ prompt: "demo" });
