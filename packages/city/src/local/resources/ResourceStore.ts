/**
 * 本机管理数据组合。只读模式不初始化 schema、创建 root 或装配 Agent。
 * 获取租约由调用方负责，业务数据库的生命周期始终短于 root 租约。
 */
import fs from "node:fs";
import path from "node:path";
import { LocalDatabase } from "../database/LocalDatabase.js";
import { ensure_local_schema } from "../database/LocalSchema.js";
import { AgentRepository } from "../repositories/AgentRepository.js";
import { WorkspaceRepository } from "../repositories/WorkspaceRepository.js";
import { GroupRepository } from "../repositories/GroupRepository.js";
import { CityTokenRepository } from "../repositories/CityTokenRepository.js";
import { ResourceError } from "./ResourceError.js";

/** 管理用仓储组合；不包含会创建目录或注册运行能力的 Provider。 */
export class ResourceStore {
  /** 已存在或显式写请求初始化的配置 DB。 */
  readonly database: LocalDatabase | null;
  /** 文件型 Agent 事实源。 */
  readonly agents: AgentRepository;
  /** 缺 DB 的只读空 root 返回 null。 */
  readonly workspaces: WorkspaceRepository | null;
  /** 持久化 Group 引用，不能用运行时已加载集合替代。 */
  readonly groups: GroupRepository | null;
  /** 只读取公开授权摘要。 */
  readonly tokens: CityTokenRepository | null;

  constructor(root_path: string, writable: boolean, immutable: boolean) {
    const filename = path.join(root_path, "downcity.db");
    this.database = writable || fs.existsSync(filename) ? new LocalDatabase({ filename, read_only: !writable, immutable: !writable && immutable }) : null;
    this.agents = new AgentRepository(root_path);
    try {
      if (writable) {
        ensure_local_schema(this.database!);
        this.agents.recover_pending_commits();
      } else if (this.database) {
        for (const table of ["workspaces", "groups", "city_tokens"]) {
          if (!this.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) throw new ResourceError("migration_required", "Start a supported City host explicitly to initialize the current schema", 5);
        }
      }
      this.workspaces = this.database ? new WorkspaceRepository(this.database) : null;
      this.groups = this.database ? new GroupRepository(this.database) : null;
      this.tokens = this.database ? new CityTokenRepository(this.database) : null;
    } catch (error) { this.database?.close(); throw error; }
  }

  /** Registry 强引用，不泄漏 token 哈希、配置或凭据。 */
  agent_references(agent_id: string): Record<string, unknown>[] {
    return [
      ...(this.groups?.list().filter((group) => group.member_agent_ids.includes(agent_id)).map((group) => ({ kind: "group", group_id: group.group_id })) ?? []),
      ...(this.tokens?.list().filter((token) => token.agent_ids.includes(agent_id)).map((token) => ({ kind: "city_token", token_id: token.token_id })) ?? []),
    ];
  }

  /** 必须在释放租约之前关闭。 */
  close(): void { this.database?.close(); }
}
