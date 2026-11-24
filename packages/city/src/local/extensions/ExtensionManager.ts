/**
 * 扩展项目操作协调器。共享 CLI/Desktop 同一持久协议，不自取根租约、不创建 City。
 * 源码准备与入口执行分离；切换目标先落库，重启依据该目标而非文件时间恢复。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ExtensionRepository } from "../repositories/ExtensionRepository.js";
import type { ExtensionRecord, ExtensionResult, ExtensionManagerOptions, ExtensionSource, ExtensionConfigurationView } from "../types/Extension.js";
import { normalize_extension_source, resolve_extension_ref } from "./ExtensionSource.js";
import { prepare_extension_snapshot, verify_extension_snapshot } from "./ExtensionCompiler.js";
import { ExtensionConfigurationRequest } from "./ExtensionConfiguration.js";
import { ExtensionSecrets } from "./ExtensionSecrets.js";
import { ExtensionFailure, extension_error } from "./ExtensionError.js";

/** 一份数据根只装配一份实例，跨进程互斥由外层租约保证。 */
export class ExtensionManager {
  /** 关闭请求入口与占用检查期间也必须拒绝同项目操作。 */
  private readonly operations = new Set<string>();
  /** 来源解析尚未固定项目 ID 的 add 保持串行。 */
  private adding = false;

  constructor(private readonly repository: ExtensionRepository, private readonly options: ExtensionManagerOptions) {}

  /** 真实活动运行来自宿主，持久 ready 不能在离线查询时冒充在线。 */
  list(): ExtensionResult[] { return this.repository.list().map((record) => this.result(record)); }

  /** 唯一选择器为完整 extension_id。 */
  show(extension_id: string): ExtensionResult { return this.result(this.require_record(extension_id)); }

  /** 相同操作 ID 必须有相同输入，结果在断开连接后仍可查询。 */
  operation(operation_id: string) { return this.repository.get_operation(operation_id); }

  /** 添加同来源不隐式重新加载；已移除来源恢复原身份。 */
  async add(input: string, cwd = process.cwd(), ref?: string, operation_id: string = randomUUID()): Promise<ExtensionResult> {
    if (this.adding) throw new ExtensionFailure("project_busy", "Another extension source is being resolved; retry", "source", 4);
    this.adding = true;
    try {
      let source = await normalize_extension_source(input, cwd, ref);
      // 无 ref 来源先查保留记录，远端默认分支变更不能改变旧身份。
      if (source.kind === "git" && !source.ref) {
        const existing = this.repository.list(true).find((record) => record.source.identity.split("#", 1)[0] === source.identity && record.source.default_ref);
        source = existing?.source ?? await resolve_extension_ref(source);
      } else if (source.kind === "git") source = await resolve_extension_ref(source);
      const previous = this.repository.get_operation(operation_id);
      if (previous) {
        const fingerprint = createHash("sha256").update(`add\0${source.identity}`).digest("hex");
        if (previous.fingerprint !== fingerprint) throw new ExtensionFailure("operation_conflict", "operation_id was already used with different input", "source", 2);
        if (previous.result) return previous.result;
        throw new ExtensionFailure("project_busy", "Operation is already accepted; query its project", "host", 4);
      }
      const existing = this.repository.find_source(source.identity);
      if (existing && existing.status !== "removed") return this.result(existing);
      const extension_id = existing?.extension_id ?? randomUUID();
      const record = existing ?? this.new_record(extension_id, source);
      return await this.mutate(record, "add", operation_id, source.identity, async () => await this.prepare(record));
    } finally { this.adding = false; }
  }

  /** 失败准备保留旧目标与活动运行；只有进入切换阶段才发布新启动目标。 */
  async reload(extension_id: string, operation_id: string = randomUUID()): Promise<ExtensionResult> {
    const record = this.require_record(extension_id);
    if (record.status === "removed") throw new ExtensionFailure("project_removed", "Add the project source again before reloading", "source", 2);
    return await this.mutate(record, "reload", operation_id, extension_id, async () => await this.prepare(record));
  }

  /** 配置视图返回普通值和已保存秘密字段名，绝不回传秘密本身。 */
  async configuration(extension_id: string): Promise<ExtensionConfigurationView> {
    const record = this.require_record(extension_id);
    const secrets = await new ExtensionSecrets(this.options.root_path).read(extension_id, record.configuration_version);
    return { fields: record.configuration_fields ?? [], config: structuredClone(record.configurations[record.configuration_version] ?? {}), configured_secrets: Object.keys(secrets), staged_version: record.configuration_version, applied_version: record.active_snapshot?.configuration_version ?? record.target_snapshot?.configuration_version ?? null };
  }

  /** 普通配置版本只作为待应用值，实际生效须用户重新加载。 */
  async configure(extension_id: string, configuration: Record<string, unknown>, operation_id: string = randomUUID(), secrets: Record<string, string> = {}): Promise<ExtensionResult> {
    const record = this.require_record(extension_id);
    for (const name of Object.keys(configuration)) {
      if (record.configuration_fields?.some((field) => field.name === name && field.secret)) throw new ExtensionFailure("configuration_invalid", "Secret fields must be submitted through the private input channel", "load", 2);
    }
    for (const [name, value] of Object.entries(secrets)) {
      if (typeof value !== "string" || !record.configuration_fields?.some((field) => field.name === name && field.secret)) throw new ExtensionFailure("configuration_invalid", "Only requested secret fields can be submitted", "load", 2);
    }
    return await this.mutate(record, "configure", operation_id, JSON.stringify([configuration, secrets]), async () => {
      const version = randomUUID();
      const store = new ExtensionSecrets(this.options.root_path);
      const previous = await store.read(extension_id, record.configuration_version);
      await store.write(extension_id, version, { ...previous, ...secrets });
      record.configurations[version] = structuredClone(configuration);
      record.configuration_version = version;
      record.error = null;
    });
  }

  /** 保留身份、配置与 data；源码原目录从不属于清理范围。 */
  async remove(extension_id: string, operation_id: string = randomUUID()): Promise<ExtensionResult> {
    const record = this.require_record(extension_id);
    return await this.mutate(record, "remove", operation_id, extension_id, async () => {
      if (record.status === "removed") return;
      // 扩展 Downtown 已登记到 Town，卸载由运行时连接租约检查，不读取全局 selected 绑定。
      await this.options.runtime?.close_gate(extension_id);
      await this.options.runtime?.release(extension_id);
      record.status = "removed";
      record.active_snapshot = null;
      record.pending_snapshot = null;
      record.target_snapshot = null;
      record.capability_counts = null;
      // 先提交移除事实，崩溃后残留缓存不得被当成启动目标。
      this.repository.save(record);
      await fs.rm(path.join(this.project_path(extension_id), "cache"), { recursive: true, force: true });
    });
  }

  /** 宿主在恢复 Agent 之前调用。每项目只尝试一次，隔离单项失败。 */
  async restore(): Promise<ExtensionResult[]> {
    if (!this.options.runtime) throw new ExtensionFailure("host_required", "An extension runtime is required for restore", "host", 5);
    const results: ExtensionResult[] = [];
    for (const record of this.repository.list()) {
      if (!record.target_snapshot) { results.push(this.result(record)); continue; }
      results.push(await this.mutate(record, "restore", randomUUID(), record.target_snapshot.snapshot_id, async () => {
        await verify_extension_snapshot(this.snapshot_path(record), record.target_snapshot!, this.options.host_modules);
        await this.load(record);
      }));
    }
    return results;
  }

  private async prepare(record: ExtensionRecord): Promise<void> {
    const snapshot = await prepare_extension_snapshot(record.source, { ...this.options, extension_id: record.extension_id, configuration_version: record.configuration_version, previous_snapshot: record.target_snapshot });
    // 门禁实现必须原子暂停入口并检查所有使用者，busy 不能改变持久目标。
    await this.options.runtime?.close_gate(record.extension_id);
    record.target_snapshot = snapshot;
    record.pending_snapshot = snapshot;
    record.status = "pending";
    record.error = null;
    this.repository.save(record);
    if (this.options.runtime) {
      await this.options.runtime.release(record.extension_id);
      record.active_snapshot = null;
      record.status = "loading";
      this.repository.save(record);
      await this.load(record);
    }
  }

  private async load(record: ExtensionRecord): Promise<void> {
    const counts = await this.options.runtime!.load(record, this.snapshot_path(record));
    record.active_snapshot = record.target_snapshot;
    record.successful_snapshot = record.target_snapshot;
    record.pending_snapshot = null;
    record.capability_counts = counts;
    record.status = "ready";
    record.error = null;
  }

  private async mutate(record: ExtensionRecord, method: string, operation_id: string, input: string, execute: () => Promise<void>): Promise<ExtensionResult> {
    if (!operation_id.trim()) throw new ExtensionFailure("operation_invalid", "operation_id is required", "source", 2);
    const fingerprint = createHash("sha256").update(`${method}\0${input}`).digest("hex");
    const previous = this.repository.get_operation(operation_id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new ExtensionFailure("operation_conflict", "operation_id was already used with different input", "source", 2);
      if (previous.result) return previous.result;
      throw new ExtensionFailure("project_busy", "Operation was accepted and has no final result yet; query the project", "host", 4);
    }
    if (this.operations.has(record.extension_id)) throw new ExtensionFailure("project_busy", "Another project operation is in progress", "host", 4);
    this.operations.add(record.extension_id);
    record.operation_id = operation_id;
    const operation = { operation_id, fingerprint, extension_id: record.extension_id, result: null as ExtensionResult | null };
    this.repository.commit(record, operation);
    try {
      await execute();
      record.error = null;
    } catch (error) {
      record.error = extension_error(error, "load");
      if (error instanceof ExtensionConfigurationRequest) record.configuration_fields = error.fields;
      const active = this.options.runtime?.active_snapshot(record.extension_id);
      if (active) record.status = "ready";
      else if (error instanceof ExtensionFailure && error.code === "configuration_required") record.status = "needs_configuration";
      else if (!record.target_snapshot || this.options.runtime) record.status = "error";
    } finally {
      operation.result = this.result(record);
      this.repository.commit(record, operation);
      try { this.options.changed?.({ kind: "extension", id: record.extension_id, operation: method === "remove" && record.status === "removed" ? "removed" : method === "add" ? "created" : "updated" }); } catch { console.warn("Extension change subscriber failed"); }
      this.operations.delete(record.extension_id);
    }
    return operation.result;
  }

  private result(record: ExtensionRecord): ExtensionResult {
    const active = this.options.runtime?.active_snapshot(record.extension_id);
    const active_snapshot = active && active === record.active_snapshot?.snapshot_id ? record.active_snapshot : null;
    return { extension_id: record.extension_id, operation_id: record.operation_id, source: structuredClone(record.source), name: record.target_snapshot?.name ?? record.name, status: record.status === "ready" && !active_snapshot ? "pending" : record.status, active_snapshot, pending_snapshot: record.pending_snapshot, capability_counts: active_snapshot ? record.capability_counts : null, error: record.error, warnings: this.options.runtime?.warnings?.(record.extension_id) ?? [] };
  }

  private require_record(extension_id: string): ExtensionRecord {
    const record = this.repository.get(extension_id);
    if (!record) throw new ExtensionFailure("project_not_found", "Extension project was not found", "source", 2);
    return record;
  }

  private new_record(extension_id: string, source: ExtensionSource): ExtensionRecord {
    return { extension_id, source, name: path.basename(source.location), operation_id: null, status: "pending", active_snapshot: null, pending_snapshot: null, target_snapshot: null, successful_snapshot: null, capability_counts: null, error: null, configuration_version: "initial", configurations: { initial: {} } };
  }

  private project_path(extension_id: string): string { return path.join(this.options.root_path, "extensions", extension_id); }
  private snapshot_path(record: ExtensionRecord): string { return path.join(this.project_path(record.extension_id), "cache", record.target_snapshot!.snapshot_id); }
}
