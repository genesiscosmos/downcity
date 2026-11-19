/**
 * 从运行实例实际注册表生成 OpenAPI 3.1。
 *
 * 不执行就绪检查、instruction 或业务处理器。ALL/wildcard 保留在扩展字段，
 * 不生成不存在的业务 action；别名仅来自 Federation 路由明确提供的入口。
 */
import type { Service, RouteAuth } from "../service/service.js";
import type { ApiDocumentation, ApiSchema } from "../types/ServiceDiscovery.js";
import { endpoint_aliases, is_documented_schema } from "./service-catalog.js";

const error_schema: ApiSchema = {
  description: "框架错误使用error对象，Channel或业务Response也可能直接返回error字符串。原生协议可有独立格式。",
  oneOf: [
    { type: "object", required: ["error"], properties: { error: {
      type: "object", required: ["code", "message", "type", "request_id"],
      properties: { code: { type: "string" }, message: { type: "string" }, type: { type: "string" }, request_id: { type: "string" } },
    } } },
    { type: "object", required: ["error"], properties: { error: { type: "string" } } },
  ],
};

/** 将注册示例按用途转换为 OpenAPI examples；忽略未提供的响应。 */
function examples_for(documentation: ApiDocumentation | undefined, field: "request" | "response"): ApiSchema {
  return Object.fromEntries((documentation?.examples ?? []).flatMap((example, index) => (
    example[field] === undefined ? [] : [[`example_${index + 1}`, { summary: example.name, value: example[field] }]]
  )));
}

/** 合并单媒体类型和多媒体类型响应文档。 */
function response_content(documentation?: ApiDocumentation): ApiSchema | undefined {
  const schemas = documentation?.response_content ?? (is_documented_schema(documentation?.response_schema)
    ? { [documentation!.response_content_type ?? "application/json"]: documentation!.response_schema! } : undefined);
  if (!schemas || !Object.keys(schemas).length) return undefined;
  const entries = Object.entries(schemas).filter(([, schema]) => is_documented_schema(schema));
  if (!entries.length) return undefined;
  return Object.fromEntries(entries.map(([media_type, schema]) => [media_type, {
    schema,
    ...(media_type === "application/json" && Object.keys(examples_for(documentation, "response")).length
      ? { examples: examples_for(documentation, "response") } : {}),
  }]));
}

/** 记录鉴权身份，Bearer只表达凭据形式，具体身份集合仍由扩展字段给出。 */
function security_for(auth: RouteAuth): ApiSchema[] {
  return auth.length ? [{ bearerAuth: [] }] : [];
}

/** 为单一实际 HTTP 方法生成操作。 */
function build_operation(service: Service, endpoint_id: string, method: string, auth: RouteAuth, body: "json" | "raw", documentation?: ApiDocumentation, native = false): ApiSchema {
  const content = response_content(documentation);
  const responses: Record<string, unknown> = {
    [String(documentation?.response_status ?? 200)]: {
      description: documentation?.description ?? "成功响应；此入口尚未声明详细响应协议。",
      ...(content ? { content } : {}),
    },
  };
  const errors = new Map<number, string>();
  if (!native && method !== "GET" && body === "json") errors.set(400, "请求必须是有效的JSON对象。 ");
  if (auth.length) { errors.set(401, "缺少或无效凭据。 "); errors.set(403, "凭据身份不允许访问此入口。 "); }
  for (const error of documentation?.errors ?? []) errors.set(error.status, [errors.get(error.status), error.description].filter(Boolean).join(" "));
  for (const [status, description] of errors) {
    responses[String(status)] = { description, ...(!native ? { content: { "application/json": { schema: error_schema } } } : {}) };
  }
  const operation: ApiSchema = {
    operationId: `${encodeURIComponent(service.id)}_${method.toLowerCase()}_${encodeURIComponent(endpoint_id)}`,
    tags: [service.id], ...(documentation?.description ? { description: documentation.description } : {}),
    security: security_for(auth), responses, "x-downcity-auth": auth,
    "x-downcity-kind": native ? "native" : "action", "x-downcity-body": body,
    "x-downcity-documentation": {
      request: is_documented_schema(documentation?.request_schema), response: Boolean(content),
    },
    ...(documentation?.protocol ? { "x-downcity-protocol": documentation.protocol } : {}),
    ...(documentation?.requirements ? { "x-downcity-requirements": documentation.requirements } : {}),
  };
  if (documentation?.request_schema && method === "GET" && !native) {
    const properties = documentation.request_schema.properties as Record<string, ApiSchema> | undefined;
    const required = documentation.request_schema.required as string[] | undefined;
    operation.parameters = Object.entries(properties ?? {}).map(([name, schema]) => ({
      name, in: "query", required: required?.includes(name) ?? false, schema,
      ...(typeof schema.description === "string" ? { description: schema.description } : {}),
    }));
    operation["x-downcity-request-schema"] = documentation.request_schema;
  } else if (documentation?.request_schema && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    operation.requestBody = {
      required: Array.isArray(documentation.request_schema.required) && documentation.request_schema.required.length > 0,
      content: { [documentation.request_content_type ?? (body === "raw" ? "text/plain" : "application/json")]: {
        schema: documentation.request_schema,
        ...(Object.keys(examples_for(documentation, "request")).length ? { examples: examples_for(documentation, "request") } : {}),
      } },
    };
  } else if (documentation?.request_schema) {
    operation["x-downcity-request-schema"] = documentation.request_schema;
  }
  return operation;
}

/** 注册 paths，原生 wildcard 使用路径参数并通过扩展声明其真实语义。 */
function add_path(paths: Record<string, ApiSchema>, path: string, method: string, operation: ApiSchema): void {
  const wildcard = path.includes("*");
  const normalized_path = path.replace(/\*/g, "{wildcard}");
  const item = paths[normalized_path] ??= {};
  if (wildcard) {
    operation["x-downcity-wildcard-path"] = path;
    operation.parameters = [
      ...((operation.parameters as unknown[]) ?? []),
      { name: "wildcard", in: "path", required: true, schema: { type: "string" }, description: "匹配任意后续路径；框架也可能匹配空尾段，OpenAPI模板无法完整表达。" },
    ];
  }
  item[method.toLowerCase()] = operation;
}

/** 构建实例级 OpenAPI；origin可选，缺省使用相对服务地址。 */
export function build_service_openapi(services: Service[], origin?: string): ApiSchema {
  const paths: Record<string, ApiSchema> = {};
  for (const service of services) {
    for (const definition of service._listActionDefs()) {
      const path = `/v1/${encodeURIComponent(service.id)}/${definition.action.id}`;
      add_path(paths, path, definition.method, build_operation(service, definition.action.id, definition.method, definition.auth, definition.body ?? "json", definition.documentation));
      for (const alias of endpoint_aliases(service, definition.action.id)) {
        const override = definition.documentation?.aliases?.[alias];
        const documentation = override ? { ...definition.documentation, ...override } : definition.documentation;
        const operation = build_operation(service, alias, definition.method, definition.auth, definition.body ?? "json", documentation);
        operation["x-downcity-alias-of"] = path;
        add_path(paths, alias, definition.method, operation);
      }
    }
    for (const definition of service._listNativeRouteDefs()) {
      const methods = definition.method === "ALL" ? ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "TRACE"] : [definition.method];
      for (const method of methods) {
        const operation = build_operation(service, definition.path, method, definition.auth, "raw", definition.documentation, true);
        if (definition.method === "ALL") operation["x-downcity-method"] = "ALL";
        add_path(paths, `/v1/${encodeURIComponent(service.id)}${definition.path}`, method, operation);
      }
    }
  }
  return {
    openapi: "3.1.0", info: { title: "Federation Service API", version: "1.0.0", description: "当前实例已注册服务的公开API。x-downcity-documentation标明schema覆盖情况；ready不代表上游在线或调用者获授权。" },
    servers: [{ url: origin ?? "/" }],
    tags: services.map((service) => ({ name: service.id, ...(service.discovery.description ? { description: service.discovery.description } : {}) })),
    paths, components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "Federation用户或管理员凭据；身份集合见x-downcity-auth。部分AI入口也支持Relay调用凭据。原生认证协议见入口说明。" } } },
  };
}
