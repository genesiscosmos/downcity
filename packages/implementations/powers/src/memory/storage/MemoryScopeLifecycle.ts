/**
 * Records 范围生命周期：可信地址首次使用时，只为经锁内元数据核验的空范围发布激活标记。
 * 已发布范围走严格读取；旧材料、孤立版本、临时文件与读取异常均不能触发空初始化。
 * 外部 Profile 等历史布局由组合根提供定向探针，不扫描 Session 或用户业务目录。
 */
import { LOCAL_USER_ID } from "@downcity/city/local";
import type { MemoryStorageAdapter } from "../types/MemoryStorage.js";
import type { MemoryScopeAddress } from "../runtime/MemoryAddress.js";
import type { MemoryScopeManifest } from "../types/MemoryTransaction.js";
import { canonical_memory_json, memory_manifest_key, read_memory_manifest } from "./MemoryRecordStore.js";
import { FileMemoryStorageAdapter } from "../adapters/FileMemoryStorageAdapter.js";

import type { MemoryLegacyScopeProbe } from "../types/BuiltinMemoryProvider.js";

/** 只接受访问解析器产生的范围身份；不能以 prefix 任意选择物理目录。 */
function assert_scope_address(address: MemoryScopeAddress): void {
  const { scope } = address;
  if (!["agent", "user", "workspace"].includes(scope.type) || !scope.id
    || (scope.type === "agent" && !/^[a-z0-9_]+$/u.test(scope.id))
    || (scope.type === "user" && scope.id !== LOCAL_USER_ID)) throw new Error("Invalid Memory scope identity");
  const expected_prefix = scope.type === "agent" ? `agent/${scope.id}` : `${scope.type}/${Buffer.from(scope.id, "utf8").toString("hex")}`;
  if (address.prefix !== expected_prefix) throw new Error("Memory scope prefix mismatch");
}

/**
 * 先做只读快路径，再在与 records commit 相同的跨进程范围锁内重新核验并发布。
 * 不缓存“空”判断；等待锁期间的迁移/首次写入优先，绝不覆盖已存在的 manifest。
 */
export async function prepare_memory_scope(storage: MemoryStorageAdapter, address: MemoryScopeAddress, legacy_probe?: MemoryLegacyScopeProbe): Promise<MemoryScopeManifest> {
  assert_scope_address(address);
  const key = memory_manifest_key(address.prefix);
  if (await storage.has(key)) return await read_memory_manifest(storage, address);
  return await storage.with_scope_lock(key, async () => {
    if (await storage.has(key)) return await read_memory_manifest(storage, address);
    if (await storage.has_entries(address.prefix) || await legacy_probe?.(address.scope)) {
      throw new Error(`MEMORY_MIGRATION_REQUIRED: ${address.scope.type}/${address.scope.id}`);
    }
    const manifest: MemoryScopeManifest = { schema_version: 2, activation: "confirmed_empty", scope: address.scope,
      scope_prefix: address.prefix, scope_version: "0", records: {}, history: {}, receipts: {}, suppressions: [] };
    await storage.write(key, canonical_memory_json(manifest));
    return manifest;
  });
}

/**
 * 本地平台已知旧布局的领域探针。File Adapter 只处理受限 key 的元数据；路径规则集中在此处。
 * 当前 memory 路径再次核验用于拒绝其平台祖先中的链接；账本和备份由主 Adapter 全前缀探针覆盖。
 * Workspace runtime 的路径段遵循 LocalStorageProvider 的 encodeURIComponent 规则。
 */
export function create_file_memory_legacy_probe(platform_root_path: string): MemoryLegacyScopeProbe {
  const platform = new FileMemoryStorageAdapter({ root_path: platform_root_path });
  return async (scope) => {
    let keys: string[];
    if (scope.type === "agent") {
      if (!/^[a-z0-9_]+$/u.test(scope.id)) throw new Error("Invalid Memory Agent identity");
      const owner = `agents/${scope.id}`;
      await platform.has(`${owner}/memory`);
      keys = [`${owner}/PROFILE.md`, `${owner}/powers/memory`];
    } else if (scope.type === "user") {
      if (scope.id !== LOCAL_USER_ID) throw new Error("Invalid local User scope");
      await platform.has("user/memory");
      keys = ["user/PROFILE.md", "user/powers/memory"];
    } else if (scope.type === "workspace" && scope.id) {
      const owner = `workspaces/${encodeURIComponent(scope.id)}`;
      keys = [`${owner}/memory`, `${owner}/powers/memory`];
    } else throw new Error("Invalid Memory scope identity");
    for (const key of keys) {
      if (key.endsWith("/PROFILE.md") ? await platform.has(key) : await platform.has_entries(key)) return true;
    }
    return false;
  };
}
