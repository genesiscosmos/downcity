/**
 * Downtown 注册表的公开服务目录投影。
 *
 * 只运行作者声明的本地检查，使用固定超时和安全错误原因；不执行业务 action。
 * 说明正文仅在详情请求解析，列表和 OpenAPI 不调用动态 instruction。
 */
import type { Service } from "../service/service.js";
import { AIService } from "../service/ai/ai-service.js";
import { resolveInstruction } from "../service/instruction.js";
import type { ApiDocumentation, ServiceAvailability, ServiceAvailabilityCheck } from "../types/ServiceDiscovery.js";
import type { PublicApiDocumentation, ServiceCatalogDetail, ServiceCatalogSummary, ServiceEndpointDetail, ServiceEndpointSummary } from "../types/ServiceCatalog.js";

const CHECK_TIMEOUT_MS = 1000;

/** 空对象不表达字段契约，不能据此声称请求或响应已被文档化。 */
export function is_documented_schema(schema: unknown): boolean {
  return Boolean(schema && typeof schema === "object" && Object.keys(schema).length > 0);
}

/** 多媒体类型响应至少需要一个有内容的 schema。 */
function has_response_schema(documentation?: ApiDocumentation): boolean {
  return is_documented_schema(documentation?.response_schema)
    || Object.values(documentation?.response_content ?? {}).some(is_documented_schema);
}

/** 有界执行本地元数据回调，吞掉原始异常并移除未允许的字段。 */
export async function read_local_availability(check?: ServiceAvailabilityCheck): Promise<ServiceAvailability> {
  if (!check) return { status: "unknown", reason: "未提供本地就绪检查。" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(check),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS); }),
    ]);
    if (!result || !["ready", "partial", "unavailable", "unknown"].includes(result.status)) {
      return { status: "unknown", reason: "就绪检查未返回有效状态。" };
    }
    return { status: result.status, ...(typeof result.reason === "string" ? { reason: result.reason } : {}) };
  } catch {
    return { status: "unknown", reason: "本地就绪检查失败或超时。" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 只投影文档白名单，不允许回调或未来添加的私有字段进入公共接口。 */
export function public_api_documentation(documentation?: ApiDocumentation): PublicApiDocumentation | null {
  if (!documentation) return null;
  return {
    description: documentation.description,
    ...(documentation.request_schema ? { request_schema: documentation.request_schema } : {}),
    ...(documentation.response_schema ? { response_schema: documentation.response_schema } : {}),
    ...(documentation.response_status !== undefined ? { response_status: documentation.response_status } : {}),
    ...(documentation.request_content_type ? { request_content_type: documentation.request_content_type } : {}),
    ...(documentation.response_content_type ? { response_content_type: documentation.response_content_type } : {}),
    ...(documentation.response_content ? { response_content: documentation.response_content } : {}),
    ...(documentation.protocol ? { protocol: documentation.protocol } : {}),
    ...(documentation.errors ? { errors: documentation.errors } : {}),
    ...(documentation.examples ? { examples: documentation.examples } : {}),
    ...(documentation.requirements ? { requirements: documentation.requirements } : {}),
  };
}

/** 框架实际注册的 AI 兼容别名；普通自定义服务不能通过文档添加路由。 */
export function endpoint_aliases(service: Service, action_id: string): string[] {
  if (!(service instanceof AIService)) return [];
  if (action_id === "models") return ["/v1/models"];
  if (action_id === "chat/completions") return ["/v1/chat/completions"];
  return [];
}

/** 服务级明确不可用时约束所有入口；入口级检查允许更精细地描述能力。 */
async function endpoint_availability(service: ServiceAvailability | undefined, documentation?: ApiDocumentation): Promise<ServiceAvailability> {
  if (service?.status === "unavailable") return service;
  return documentation?.availability ? read_local_availability(documentation.availability)
    : service ?? read_local_availability();
}

/** 将入口状态聚合为服务状态。不存在入口时保持服务自身检查结果。 */
function aggregate_availability(service: ServiceAvailability | undefined, endpoints: ServiceEndpointSummary[]): ServiceAvailability {
  if (service?.status === "unavailable") return service;
  if (!endpoints.length) return service ?? { status: "unknown", reason: "没有可检查的入口。" };
  const states = endpoints.map((endpoint) => endpoint.availability.status);
  if (states.every((status) => status === "ready")) return { status: "ready" };
  if (states.includes("ready") || states.includes("partial")) return { status: "partial", reason: "仅部分入口已确认就绪。" };
  if (states.includes("unavailable")) return { status: "unavailable", reason: "已知入口缺少必要运行条件，其余入口状态见详情。" };
  return { status: "unknown", reason: "尚无入口能够确认就绪。" };
}

/** 单次服务投影，同时用于列表和详情，检查在各入口间并行执行。 */
async function project_service(service: Service): Promise<ServiceCatalogDetail> {
  const service_availability = service.discovery.availability
    ? await read_local_availability(service.discovery.availability) : undefined;
  const actions = await Promise.all(service._listActionDefs().map(async (definition): Promise<ServiceEndpointDetail> => ({
    id: definition.action.id, kind: "action", description: definition.documentation?.description ?? null,
    method: definition.method, path: `/v1/${encodeURIComponent(service.id)}/${definition.action.id}`,
    auth: [...definition.auth], aliases: endpoint_aliases(service, definition.action.id),
    ...(definition.documentation?.protocol ? { protocol: definition.documentation.protocol } : {}),
    availability: await endpoint_availability(service_availability, definition.documentation),
    body: definition.body ?? "json", documentation: public_api_documentation(definition.documentation),
    request_documented: is_documented_schema(definition.documentation?.request_schema),
    response_documented: has_response_schema(definition.documentation),
  })));
  const routes = await Promise.all(service._listNativeRouteDefs().map(async (definition): Promise<ServiceEndpointDetail> => ({
    id: definition.path, kind: "native", description: definition.documentation?.description ?? null,
    method: definition.method, path: `/v1/${encodeURIComponent(service.id)}${definition.path}`,
    auth: [...definition.auth], aliases: [], body: "raw",
    ...(definition.documentation?.protocol ? { protocol: definition.documentation.protocol } : {}),
    availability: await endpoint_availability(service_availability, definition.documentation),
    documentation: public_api_documentation(definition.documentation),
    request_documented: is_documented_schema(definition.documentation?.request_schema),
    response_documented: has_response_schema(definition.documentation),
  })));
  return {
    id: service.id, name: service.name, description: service.discovery.description ?? null,
    requirements: [...(service.discovery.requirements ?? [])],
    env: (service.env ?? []).map(({ key, description, required }) => ({ key, description, required })),
    availability: aggregate_availability(service_availability, [...actions, ...routes]), actions, routes,
    docs_url: `/v1/services/${encodeURIComponent(service.id)}`, instruction: null, instruction_documented: false,
  };
}

/** 从详情移除大体积文档字段以获得目录摘要。 */
function summarize_endpoint(endpoint: ServiceEndpointDetail): ServiceEndpointSummary {
  const { documentation: _documentation, body: _body, request_documented: _request, response_documented: _response, ...summary } = endpoint;
  return summary;
}

/** 列出当前已注册服务，不解析动态正文。 */
export async function list_service_catalog(services: Service[]): Promise<ServiceCatalogSummary[]> {
  return Promise.all(services.map(async (service) => {
    const { instruction: _instruction, instruction_documented: _documented, ...detail } = await project_service(service);
    return { ...detail, actions: detail.actions.map(summarize_endpoint), routes: detail.routes.map(summarize_endpoint) };
  }));
}

/** 读取服务详情；缺少服务返回 undefined，由 HTTP 边界转换为404。 */
export async function get_service_catalog_detail(services: Service[], service_id: string): Promise<ServiceCatalogDetail | undefined> {
  const service = services.find((item) => item.id === service_id);
  if (!service) return undefined;
  const detail = await project_service(service);
  // instruction 作者也必须遵守公开文档约定；失败不回显原始错误或堆栈。
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    detail.instruction = await Promise.race([
      resolveInstruction(service.instruction, { id: service.id, name: service.name, env: service.env, actions: service._listInstructionActions() }),
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), CHECK_TIMEOUT_MS); }),
    ]) ?? null;
    detail.instruction_documented = detail.instruction !== null;
  } catch {
    detail.instruction = null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return detail;
}
