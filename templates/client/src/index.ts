#!/usr/bin/env node

/**
 * Downcity 本地开发 Client。
 *
 * 关键说明（中文）
 * - 用于配合 `templates/node` 本地 HTTP 服务进行交互式调试。
 * - 优先读取环境变量中的 user_token；缺失时使用 Federation Admin key 自动签发开发 token。
 * - 该入口只做本地请求与终端交互，不承载 SDK 业务逻辑。
 */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Agent, Workspace } from "@downcity/agent";
import { Bureau, City, type CityModel } from "@downcity/city";

const DEFAULT_FEDERATION_URL = "http://127.0.0.1:43127";
const DEFAULT_CITY_ID = "city_downcity";
const DEFAULT_USER_ID = "dev_cli_user";
const DEFAULT_TOKEN_TTL = "7d";
const DEFAULT_AGENT_ID = "template_client";
const DEFAULT_AGENT_PATH = ".downcity/template-client";

type LocalAgentSession = Awaited<ReturnType<typeof create_agent_session>>;

/**
 * Client 运行配置。
 */
interface ClientConfig {
  /**
   * 本地 Federation HTTP 入口地址。
   */
  federation_url: string;

  /**
   * 本次请求使用的 City ID。
   */
  city_id: string;

  /**
   * 本次请求绑定的终端用户 ID。
   */
  user_id: string;

  /**
   * 可选的 City user_token。
   *
   * 未提供时会尝试通过 Federation Admin key 自动签发。
   */
  user_token?: string;

  /**
   * 可选的 Federation Admin secret key。
   *
   * 用于本地开发时自动签发 user_token。
   */
  admin_secret_key?: string;

  /**
   * 必填的 City AIService 模型 ID。
   *
   * AIService 不会自动选择默认模型；本地 Agent 必须显式绑定模型。
   */
  model_id?: string;

  /**
   * 本地 Agent 的稳定 ID。
   */
  agent_id: string;

  /**
   * 本地 Agent 的工作目录。
   */
  agent_path: string;
}

/**
 * 读取可选环境变量。
 */
function read_optional_env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * 读取 Client 运行配置。
 */
function read_config(): ClientConfig {
  return {
    federation_url: read_optional_env("DOWNCITY_CLIENT_FEDERATION_URL") ?? read_optional_env("FEDERATION_URL") ?? DEFAULT_FEDERATION_URL,
    city_id: read_optional_env("DOWNCITY_CLIENT_CITY_ID") ?? read_optional_env("CITY_ID") ?? DEFAULT_CITY_ID,
    user_id: read_optional_env("DOWNCITY_CLIENT_USER_ID") ?? read_optional_env("USER_ID") ?? DEFAULT_USER_ID,
    user_token: read_optional_env("DOWNCITY_CLIENT_USER_TOKEN") ?? read_optional_env("USER_TOKEN"),
    admin_secret_key: read_optional_env("DOWNCITY_FEDERATION_ADMIN_SECRET_KEY") ?? read_optional_env("ADMIN_SECRET_KEY"),
    model_id: read_optional_env("DOWNCITY_CLIENT_MODEL_ID") ?? read_optional_env("MODEL_ID"),
    agent_id: read_optional_env("DOWNCITY_CLIENT_AGENT_ID") ?? DEFAULT_AGENT_ID,
    agent_path: resolve(read_optional_env("DOWNCITY_CLIENT_AGENT_PATH") ?? DEFAULT_AGENT_PATH),
  };
}

/**
 * 确保当前请求有可用 user_token。
 */
async function resolve_user_token(config: ClientConfig): Promise<string> {
  if (config.user_token) return config.user_token;
  if (!config.admin_secret_key) {
    throw new Error(
      [
        "缺少 user_token。",
        "请设置 DOWNCITY_CLIENT_USER_TOKEN，或设置 DOWNCITY_FEDERATION_ADMIN_SECRET_KEY 让 client 自动签发本地开发 token。",
        "node 模板启动后会在终端打印 Admin key。",
      ].join("\n"),
    );
  }

  const admin = new Bureau({
    federation_url: config.federation_url,
    bureau_token: config.admin_secret_key,
  });
  const issued = await admin.cities.tokens.apply({
    city_id: config.city_id,
    user_id: config.user_id,
    ttl: DEFAULT_TOKEN_TTL,
  });
  return issued.user_token;
}

/**
 * 判断 readline 是否因为输入流结束而关闭。
 */
function is_readline_closed_error(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ERR_USE_AFTER_CLOSE";
}

/**
 * 解析本地 Agent 使用的 City 模型。
 */
async function resolve_agent_model(city: City, model_id: string | undefined): Promise<CityModel> {
  const resolved_model_id = String(model_id ?? "").trim();
  if (!resolved_model_id) {
    throw new Error("必须配置 DOWNCITY_CLIENT_MODEL_ID 或 MODEL_ID，AIService 不会自动选择默认模型。");
  }
  const catalog = await city.ai.catalog();
  const models = catalog.all();
  const model = catalog.get(resolved_model_id);

  if (model) return model;
  if (models.length === 0) {
    throw new Error("当前 Federation 没有可用模型。请先在 templates/node/.env 中配置真实 DEEPSEEK_API_KEY。");
  }
  throw new Error(`模型不存在：${resolved_model_id}`);
}

/**
 * 创建本地 Agent session。
 */
async function create_agent_session(config: ClientConfig, model: CityModel) {
  mkdirSync(config.agent_path, { recursive: true });
  const agent = new Agent({
    id: config.agent_id,
    workspace: new Workspace({ path: config.agent_path }),
    model,
    instruction: [
      "你是 Downcity templates/client 的本地调试 Agent。",
      "回答要简洁、直接，优先帮助开发者验证本地 Federation 与 Agent SDK 调用链路。",
    ],
  });
  const sessions = agent.sessions;
  try {
    return await sessions.get("local_cli");
  } catch {
    return await sessions.create({ session_id: "local_cli" });
  }
}

/**
 * 打印可用模型列表。
 */
async function print_models(city: City): Promise<void> {
  const catalog = await city.ai.catalog();
  const models = catalog.all();

  if (models.length === 0) {
    console.log("当前 Federation 没有可用模型。");
    return;
  }

  console.log("可用模型：");
  for (const model of models) {
    const tags = model.tags.length > 0 ? ` [${model.tags.join(", ")}]` : "";
    console.log(`- ${model.id}${tags}`);
  }
}

/**
 * 通过 Downcity Agent SDK 执行一次文本请求。
 */
async function request_text(input: {
  city: City;
  config: ClientConfig;
  session?: LocalAgentSession;
  prompt: string;
}): Promise<LocalAgentSession> {
  const session = input.session ?? await create_agent_session(
    input.config,
    await resolve_agent_model(input.city, input.config.model_id),
  );
  const turn = await session.prompt({ query: input.prompt });
  const result = await turn.finished;
  if (result.text.trim()) {
    console.log(result.text.trim());
    return session;
  }
  if (!result.success && result.error) {
    console.error(result.error);
    return session;
  }
  console.log("(empty response)");
  return session;
}

/**
 * 运行交互式 CLI。
 */
async function main(): Promise<void> {
  const config = read_config();
  const user_token = await resolve_user_token(config);
  const city = new City({
    federation_url: config.federation_url,
    user_token,
  });
  let session: LocalAgentSession | undefined;

  console.log(`Downcity client -> ${config.federation_url}`);
  console.log(`City: ${config.city_id}`);
  console.log(`Agent: ${config.agent_id}`);
  console.log(`Model: ${config.model_id ?? "auto"}`);
  console.log("输入 prompt 后回车发送；输入 /models 查看模型；输入 /exit 退出。");

  const readline = createInterface({ input, output });
  try {
    while (true) {
      let prompt = "";
      try {
        prompt = (await readline.question("> ")).trim();
      } catch (error) {
        if (is_readline_closed_error(error)) break;
        throw error;
      }
      if (!prompt) continue;
      if (prompt === "/exit" || prompt === "/quit") break;
      if (prompt === "/models") {
        await print_models(city);
        continue;
      }

      try {
        session = await request_text({ city, config, session, prompt });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
      }
    }
  } finally {
    readline.close();
  }
}

await main();
