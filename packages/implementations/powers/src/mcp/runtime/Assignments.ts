/** Persist Agent MCP assignments independently of global connection definitions. */
import fs from "fs-extra";
import { join, resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { assert_safe_agent_id } from "@/skill/runtime/AgentRoot.js";

/** Agent-local allowlists; an absent file grants no MCP access. */
export class McpAssignments {
  /** Root containing the registered Agent directories. */
  private readonly agents_root: string;
  /** Serialize read-modify-write operations for concurrent host requests. */
  private operation: Promise<unknown> = Promise.resolve();

  constructor(agents_root: string) { this.agents_root = agents_root; }

  /** Read the persisted allowlist, rejecting malformed files rather than granting access. */
  async read(agent_id: string): Promise<string[]> {
    const file_path = await this.safe_file_path(agent_id);
    if (!await fs.pathExists(file_path)) return [];
    if (!(await fs.lstat(file_path)).isFile()) throw new Error("MCP assignments must be a regular file");
    const value: unknown = await fs.readJson(file_path);
    if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id.trim())) {
      throw new Error(`Invalid MCP assignments for Agent: ${agent_id}`);
    }
    return [...new Set(value as string[])].sort();
  }

  /** Atomically add or remove one assignment without touching connection credentials. */
  async set(agent_id: string, server_id: string, assigned: boolean): Promise<void> {
    const update = async () => {
      const file_path = await this.safe_file_path(agent_id);
      const ids = new Set(await this.read(agent_id));
      if (assigned) ids.add(server_id); else ids.delete(server_id);
      const temporary_path = `${file_path}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary_path, JSON.stringify([...ids].sort()), { mode: 0o600, flag: "wx" });
        await this.safe_file_path(agent_id);
        await fs.rename(temporary_path, file_path);
      } finally {
        await fs.remove(temporary_path);
      }
    };
    const pending = this.operation.then(update, update);
    this.operation = pending.catch(() => undefined);
    await pending;
  }

  /** Remove grants across all Agent directories before a deleted ID can be reused. */
  async purge(server_id: string): Promise<void> {
    if (!await fs.pathExists(this.agents_root)) return;
    for (const entry of await fs.readdir(this.agents_root, { withFileTypes: true })) {
      if (entry.isDirectory()) await this.set(entry.name, server_id, false);
    }
  }

  /** Reject symlink directories and ensure the Agent resolves inside the authoritative root. */
  private async safe_file_path(agent_id: string): Promise<string> {
    assert_safe_agent_id(agent_id);
    await fs.ensureDir(this.agents_root);
    if (!(await fs.lstat(this.agents_root)).isDirectory()) throw new Error("Agent root must be a real directory");
    const agent_path = join(this.agents_root, agent_id);
    await fs.ensureDir(agent_path);
    if (!(await fs.lstat(agent_path)).isDirectory()) throw new Error("Agent must be a real directory");
    const root_path = await fs.realpath(this.agents_root);
    const resolved_path = await fs.realpath(agent_path);
    if (dirname(resolved_path) !== root_path || resolved_path !== join(root_path, agent_id)) {
      throw new Error("Agent assignment path escapes the Agent root");
    }
    return join(resolve(agent_path), "mcp-servers.json");
  }
}
