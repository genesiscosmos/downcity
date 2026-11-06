/**
 * 既有 Env/Token/Power 配置入口的宿主写协调。所有持久化变更与资源删除使用同一 root
 * 租约和短事务协调器；交互收集由产品层完成，不在事务中等待用户。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { mutate_env_text } from "./EnvMutation.js";
import { LocalDatabase } from "../database/LocalDatabase.js";
import { CityTokenRepository } from "../repositories/CityTokenRepository.js";
import { PowerRepository } from "../repositories/PowerRepository.js";
import type { ResourceDependencies } from "./types.js";
import type { CityTokenConfig } from "../types/CityToken.js";
import { ResourceError, require_resource_value } from "./ResourceError.js";

/** 固定配置用例，不提供任意 SQL、任意路径写入或通用远程函数执行。 */
export class ConfigResources {
  constructor(private readonly dependencies: ResourceDependencies) {}

  /** 已有配置操作统一调度，在线必须由 root 宿主执行。 */
  async call(method: string, input: Record<string, unknown>): Promise<unknown> {
    const read_only = ["config.token.list", "config.token.get", "config.power.get", "config.env.get"].includes(method);
    const operation = async () => {
      if (method.startsWith("config.token.")) return this.token(method, input, read_only);
      if (method.startsWith("config.power.")) {
        const repository = new PowerRepository(this.dependencies.root_path);
        const power_id = String(input.power_id ?? "");
        if (method === "config.power.get") return repository.get_config(power_id);
        require_resource_value(method === "config.power.set" && input.config && typeof input.config === "object" && !Array.isArray(input.config), "Power configuration must be an object");
        const result = repository.set_config(power_id, input.config as import("@downcity/type").JsonObject);
        this.dependencies.host?.invalidate();
        return result;
      }
      require_resource_value(method.startsWith("config.env."), "Unsupported configuration operation");
      const workspace_id = typeof input.workspace_id === "string" ? input.workspace_id : undefined;
      const config = workspace_id ? this.dependencies.workspaces?.get(workspace_id) : undefined;
      if (workspace_id && !config) throw new ResourceError("workspace_missing", "Env Workspace is no longer registered", 4);
      const filename = path.join(config?.workspace_path ?? this.dependencies.root_path, ".env");
      const raw = await fs.readFile(filename, "utf8").catch((error: unknown) => { if (error instanceof Error && "code" in error && error.code === "ENOENT") return ""; throw error; });
      const values = dotenv.parse(raw);
      if (method === "config.env.get") return values;
      require_resource_value(typeof input.key === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(input.key), "Invalid Env key");
      const changed = method === "config.env.set" ? values[input.key] !== input.value : Object.hasOwn(values, input.key);
      if (method === "config.env.set") { require_resource_value(typeof input.value === "string", "Env value must be text"); values[input.key] = input.value; }
      else { require_resource_value(method === "config.env.delete", "Unsupported Env operation"); delete values[input.key]; }
      if (changed) {
        const temporary = `${filename}.${randomUUID()}.tmp`;
        await fs.writeFile(temporary, mutate_env_text(raw, input.key, method === "config.env.set" ? input.value as string : undefined), { mode: 0o600 });
        try { await fs.rename(temporary, filename); } finally { await fs.rm(temporary, { force: true }); }
        await this.dependencies.host?.refresh_env?.(workspace_id);
      }
      return { changed, broadcast: { updated_agent_ids: changed ? this.dependencies.host?.city.agents.list().map((agent) => agent.id).sort() ?? [] : [], failed_agents: [] } };
    };
    return read_only ? await operation() : await this.dependencies.coordinator.mutate(operation);
  }

  /** token Agent 引用校验在锁内重读，不能在收集表单时检查后放任删除插入。 */
  private token(method: string, input: Record<string, unknown>, read_only: boolean): unknown {
    if (!this.dependencies.workspaces && read_only) {
      if (method === "config.token.list") return [];
      throw new ResourceError("resource_not_found", "City Token not found", 3);
    }
    const filename = path.join(this.dependencies.root_path, "downcity.db");
    const database = new LocalDatabase({ filename, read_only, immutable: read_only && this.dependencies.immutable });
    try {
      const repository = new CityTokenRepository(database);
      if (method === "config.token.list") return repository.list();
      const token_id = String(input.token_id ?? "");
      if (method === "config.token.get") return repository.get(token_id);
      if (method === "config.token.remove") { repository.remove(token_id); return { deleted: token_id }; }
      const config = input.config as CityTokenConfig;
      require_resource_value(config && Array.isArray(config.agent_ids), "Token configuration is required");
      for (const agent_id of config.agent_ids) if (!this.dependencies.agents.get(agent_id)) throw new ResourceError("resource_not_found", `Agent not found: ${agent_id}`, 3);
      if (method === "config.token.create") return repository.create(config);
      require_resource_value(method === "config.token.update", "Unsupported Token operation");
      return repository.update(token_id, config);
    } finally { database.close(); }
  }
}
