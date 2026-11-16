/**
 * 扩展命令的本机路由。已有宿主只走其管理通道，禁止失败后离线越权；
 * 无宿主时显式取得租约，只准备快照和登记，不执行入口或创建 City。
 */
import path from "node:path";
import fs from "node:fs";
import { read_city_host_state } from "@downcity/city";
import { RootLease, LocalDatabase, ExtensionRepository, ExtensionManager, ExtensionService, resolve_resource_root, LocalHostClient, resolve_extension_host_modules, normalize_extension_source, ExtensionFailure } from "@downcity/city/local";

/** 生命周期只覆盖单次 CLI 调用，在线状态由实际宿主投影。 */
export class ExtensionClient {
  readonly root_path: string;

  constructor(root?: string) { this.root_path = resolve_resource_root(root); }

  async call(method: string, input: Record<string, unknown> = {}): Promise<unknown> {
    if (method === "extension.add" && typeof input.source === "string") {
      const source = await normalize_extension_source(input.source, process.cwd(), typeof input.ref === "string" ? input.ref : undefined);
      if (source.kind === "local") input = { ...input, source: source.location, cwd: process.cwd() };
    }
    const client = await LocalHostClient.connect({ root_path: this.root_path });
    if (client) {
      try { return await client.call(method, input, { timeout_ms: 360000 }); }
      finally { await client.close(); }
    }
    const readonly = ["extension.list", "extension.show", "extension.operation", "extension.configuration", "extension.definitions", "extension.connections"].includes(method);
    if (readonly && !fs.existsSync(path.join(this.root_path, "downcity.db"))) {
      if (method === "extension.list") return [];
      throw new ExtensionFailure("project_not_found", "Extension project was not found", "source", 2);
    }
    if (["extension.definitions", "extension.connections", "extension.select_connection"].includes(method)) throw new ExtensionFailure("host_required", "Capability selection requires a running host; offline commands never execute entries", "host", 5);
    const lease = readonly ? RootLease.acquire_read(this.root_path) : RootLease.acquire_write(this.root_path);
    let database: LocalDatabase | undefined;
    try {
      if (await read_city_host_state(this.root_path)) throw new ExtensionFailure("host_unreachable", "A host became active; retry through its management channel", "host", 5);
      database = new LocalDatabase({ filename: path.join(this.root_path, "downcity.db"), read_only: readonly, immutable: readonly });
      const repository = new ExtensionRepository(database, !readonly);
      const manager = new ExtensionManager(repository, { root_path: this.root_path, host_modules: readonly ? {} : resolve_extension_host_modules() });
      return await new ExtensionService(manager).dispatch(method, input);
    } finally { database?.close(); lease.release(); }
  }
}
