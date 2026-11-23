/**
 * 单项目执行、校验及整批发布。City 唯一拥有 Power 生命周期，项目运行唯一拥有
 * 模型、Federation 与作者资源；失败的清理保留运行记录与门禁，禁止叠加另一套实例。
 */
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Downtown } from "@downcity/downtown";
import type { ModelClient } from "@downcity/type";
import type { City } from "../../city/runtime/City.js";
import type { CityPowerBatch } from "../../city/types/CityPowerBatch.js";
import type { PowerDefinition } from "../../power/index.js";
import type { ExtensionRuntime, ExtensionRecord, ExtensionCapabilityCounts, ExtensionError } from "../types/Extension.js";
import type { ExtensionProject, ExtensionContext, ExtensionEntry } from "../types/ExtensionProject.js";
import type { ExtensionHostOptions } from "../types/ExtensionHost.js";
import { ExtensionGate, track_extension_stream } from "./ExtensionGate.js";
import { ExtensionPower } from "./ExtensionPower.js";
import { ExtensionFailure } from "./ExtensionError.js";
import { ExtensionConfigurationRequest } from "./ExtensionConfiguration.js";
import { verify_extension_snapshot } from "./ExtensionCompiler.js";
import type { ExtensionPowerView, ExtensionRendererArtifact } from "../types/ExtensionRenderer.js";
import { compile_extension_renderer, EXTENSION_BROWSER_MODULES, read_extension_renderer_resource } from "./ExtensionRendererCompiler.js";
import { extension_entry_id } from "./ExtensionModelRegistry.js";

/** 每个运行代次的独立资源集合。 */
class ProjectRun {
  readonly gate = new ExtensionGate(true);
  power_batch?: CityPowerBatch;
  readonly power_ids: string[] = [];
  readonly model_ids: string[] = [];
  readonly agent_ids: string[] = [];
  readonly federation_ids: string[] = [];
  /** Town 统一目录中的直接模型 ID，和扩展内部别名分开保存。 */
  readonly town_model_ids: string[] = [];
  /** Town 统一目录中的扩展连接 ID。 */
  readonly town_connection_ids: string[] = [];
  readonly cleanup = new Map<object, () => void | Promise<void>>();
  warnings: ExtensionError[] = [];
  readonly powers = new Map<string, ExtensionPowerView>();
  readonly renderers = new Map<string, ExtensionRendererArtifact>();
  published = false;

  constructor(readonly snapshot_id: string) {}
}

/** 宿主正常启动时装配，不属于离线管理路径。 */
export class ExtensionHost implements ExtensionRuntime {
  private readonly runs = new Map<string, ProjectRun>();

  constructor(private readonly options: ExtensionHostOptions) {}

  active_snapshot(extension_id: string): string | null {
    const run = this.runs.get(extension_id);
    return run?.published ? run.snapshot_id : null;
  }

  /** 稳定条目借用入口；整个项目暂停时不能进入新执行或取得连接。 */
  acquire(extension_id: string, consumer: string): () => void {
    const run = this.runs.get(extension_id);
    if (!run?.published) throw new ExtensionFailure("project_unavailable", "Extension capability is unavailable", "load");
    return run.gate.acquire(consumer);
  }

  /** 只发布初始化完整成功的 Power/UI 目录；CLI 与 Desktop 读取同一绑定。 */
  power_catalog(): ExtensionPowerView[] { return [...this.runs.values()].flatMap((run) => run.published ? [...run.powers.values()] : []); }

  /** 旧页面与旧 URL 即使缓存仍在，也不能读取已替换运行的资源。 */
  async renderer_resource(power_id: string, generation: string, resource: string): Promise<Response> {
    const view = this.power_catalog().find((item) => item.power_id === power_id && item.generation === generation);
    if (!view) return new Response("Renderer generation is no longer active", { status: 410 });
    const run = this.runs.get(view.extension_id)!;
    const artifact = run.renderers.get(power_id);
    if (!artifact) return new Response("Not Found", { status: 404 });
    const release = run.gate.acquire(`renderer-resource:${power_id}`);
    try { return await read_extension_renderer_resource(artifact, resource); } finally { release(); }
  }

  /** UI 动作在检查代次与执行之间持有同一门禁，防止迟到调用进入新运行。 */
  async invoke_renderer(power_id: string, generation: string, surface: "mainview" | "config", action_id: string, input?: import("../../power/index.js").PowerJsonValue) {
    const view = this.power_catalog().find((item) => item.power_id === power_id && item.generation === generation);
    if (!view) throw new ExtensionFailure("renderer_generation_expired", "This extension page has been replaced or removed; reopen it", "load");
    const release = this.acquire(view.extension_id, `renderer-action:${power_id}`);
    try { return surface === "config" ? await this.options.city.powers.invoke_config(power_id, action_id, input) : await this.options.city.powers.invoke(power_id, action_id, input); }
    finally { release(); }
  }

  /** 当前运行的非致命诊断。 */
  warnings(extension_id: string): readonly ExtensionError[] { return this.runs.get(extension_id)?.warnings ?? []; }

  /** 当前连接绑定和活动 Session 由组合根补齐检查；门禁先关闭，不留新请求窗口。 */
  async close_gate(extension_id: string): Promise<void> {
    const run = this.runs.get(extension_id);
    if (!run) return;
    run.gate.close();
    try { await this.options.assert_idle(extension_id); }
    catch (error) { run.gate.open(); throw error; }
  }

  /** 清理失败保留剩余资源，不将项目从运行集合隐藏。 */
  async release(extension_id: string): Promise<void> {
    const run = this.runs.get(extension_id);
    if (!run) return;
    run.published = false;
    await run.gate.lifecycle(async () => await run.power_batch?.dispose());
    run.power_batch = undefined;
    run.power_ids.length = 0;
    const town = get_town(this.options.city);
    while (run.town_model_ids.length) { town.models.unregister(run.town_model_ids.at(-1)!); run.town_model_ids.pop(); }
    while (run.town_connection_ids.length) { await town.remove(run.town_connection_ids.at(-1)!); run.town_connection_ids.pop(); }
    for (const id of run.agent_ids) this.options.catalog.agents.delete(id);
    for (const id of run.model_ids) this.options.catalog.models.remove(id);
    for (const id of run.federation_ids) this.options.catalog.federations.delete(id);
    for (const [resource, callback] of [...run.cleanup].reverse()) {
      try { await run.gate.lifecycle(callback); run.cleanup.delete(resource); }
      catch { throw new ExtensionFailure("cleanup_failed", "Extension resource cleanup failed; another runtime cannot be created", "dispose"); }
    }
    for (const artifact of run.renderers.values()) await fs.rm(artifact.directory, { recursive: true, force: true });
    this.runs.delete(extension_id);
    this.options.refresh_agents?.(extension_id);
    this.options.invalidate();
  }

  /** 只在准备完整且旧运行释放后调用；不接受半成功能力目录。 */
  async load(record: ExtensionRecord, snapshot_path: string): Promise<ExtensionCapabilityCounts> {
    if (this.runs.has(record.extension_id)) throw new ExtensionFailure("cleanup_failed", "Previous extension runtime has not been released", "dispose");
    const snapshot = record.target_snapshot;
    if (!snapshot) throw new ExtensionFailure("snapshot_invalid", "No extension snapshot was selected", "load");
    await verify_extension_snapshot(snapshot_path, snapshot, this.options.host_modules);
    const run = new ProjectRun(snapshot.snapshot_id);
    this.runs.set(record.extension_id, run);
    const controller = new AbortController();
    const data_path = path.resolve(snapshot_path, "..", "..", "data");
    const context: ExtensionContext = {
      extension_id: record.extension_id, config: Object.freeze(structuredClone(record.configurations[snapshot.configuration_version] ?? {})), data_path, signal: controller.signal,
      secrets: { get: async (name) => await this.options.secret(record.extension_id, snapshot.configuration_version, name) },
      require_configuration: (fields) => { throw new ExtensionConfigurationRequest(fields); },
      on_dispose: (callback, resource) => { run.cleanup.set(resource ?? callback, callback); },
    };
    try {
      await fs.mkdir(data_path, { recursive: true, mode: 0o700 });
      const loaded = await import(pathToFileURL(path.join(snapshot_path, snapshot.entry)).href) as { default?: ExtensionEntry };
      const raw = typeof loaded.default === "function" ? await loaded.default(context) : loaded.default;
      // 在整个协议校验前接管可识别资源，即使另一个条目无效也不会丢失清理责任。
      const candidate = raw && typeof raw === "object" ? raw as ExtensionProject : {};
      for (const entries of [candidate.models, candidate.federations]) {
        if (!Array.isArray(entries)) continue;
        for (const resource of entries) {
          if (resource && typeof resource === "object" && typeof resource.dispose === "function") run.cleanup.set(resource, async () => await resource.dispose());
        }
      }
      const powers: PowerDefinition[] = Array.isArray(candidate.powers) ? candidate.powers.filter((power) => power && typeof power.name === "string" && typeof power.compile_tool === "function" && typeof power.compile_hooks === "function") : [];
      const unique_powers = [...new Set(powers)];
      const adapters = unique_powers.map((power, index) => {
        // 无效的重复本地 ID 也先取得不同清理上下文，随后统一协议校验拒绝发布。
        const duplicated = unique_powers.filter((item) => item.name === power.name).length > 1;
        const local_id = duplicated ? `${power.name}\0invalid-${index}` : power.name;
        return new ExtensionPower(extension_entry_id(record.extension_id, "power", local_id), power, run.gate);
      });
      run.power_batch = this.options.city.powers.prepare(adapters);
      for (const power of powers) run.cleanup.delete(power);
      const project = validate_project(raw);
      for (const power of project.powers ?? []) {
        const power_id = extension_entry_id(record.extension_id, "power", power.name);
        const renderer = power.renderer;
        if (renderer) {
          if (!renderer.entry || typeof renderer.entry !== "string" || Object.keys(renderer).some((key) => !["entry", "sidebar", "mainview", "config"].includes(key)) || [renderer.sidebar, renderer.mainview, renderer.config].some((value) => value !== undefined && typeof value !== "boolean") || Boolean(renderer.sidebar) !== Boolean(renderer.mainview)) throw new ExtensionFailure("renderer_invalid", "Renderer requires an entry, boolean slot flags and matching sidebar/mainview", "load", 2);
          const artifact = await compile_extension_renderer({ source_path: path.join(snapshot_path, "source"), output_path: path.resolve(snapshot_path, "..", "..", "renderers", snapshot.snapshot_id, power_id), entry: renderer.entry, resource_base_url: `downcity-power://extension/${power_id}/${snapshot.snapshot_id}/`, runtime_modules: EXTENSION_BROWSER_MODULES });
          run.renderers.set(power_id, artifact);
        }
        const artifact = run.renderers.get(power_id);
        run.powers.set(power_id, { power_id, title: power.title || power.name, description: power.description, extension_id: record.extension_id, generation: snapshot.snapshot_id, ...(renderer && artifact ? { renderer: { ...renderer }, entry: artifact.entry, styles: artifact.styles } : {}) });
      }
      // ready 可能有数据库副作用，但此时所有资源已接管、执行门禁关闭且目录不可见。
      const town = get_town(this.options.city);
      for (const federation of project.federations ?? []) {
        await federation.ready();
        const connection_id = extension_entry_id(record.extension_id, "federation", federation.id);
        const remove_guard = federation.guard_requests(() => run.gate.acquire(`federation:${connection_id}`));
        run.cleanup.set(federation, async () => { await federation.dispose(); remove_guard(); });
        town.add(connection_id, federation, { name: federation.name, auth_scope_id: `extension:${randomUUID()}`, durable: false });
        run.town_connection_ids.push(connection_id);
      }
      await run.gate.lifecycle(async () => await run.power_batch!.initialize());
      const model_references = new Map<ModelClient, ModelClient>();
      for (const model of project.models ?? []) {
        const source_id = extension_entry_id(record.extension_id, "model", model.id);
        const guarded: ModelClient = {
          id: model.id, binding_id: model.binding_id, name: model.name, context_window: model.context_window, model_stream_policy: model.model_stream_policy,
          stream: async (call, signal) => {
            const release = run.gate.acquire(`model:${source_id}`);
            try { return track_extension_stream(await model.stream(call, signal), release, signal); }
            catch (error) { release(); throw error; }
          },
        };
        const model_id = town.models.register({ source_id, client: guarded, name: model.name, durable: false });
        run.town_model_ids.push(model_id);
        const town_model = town.models.client(model_id);
        const registered = this.options.catalog.models.register(model_id, town_model, run.gate);
        model_references.set(model, registered);
        run.model_ids.push(model_id);
      }
      for (const power of project.powers ?? []) {
        const id = extension_entry_id(record.extension_id, "power", power.name);
        run.power_ids.push(id);
        // 实例已由 City batch 接管，发布阶段不再执行异步初始化。
      }
      for (const agent of project.agents ?? []) {
        const id = extension_entry_id(record.extension_id, "agent", agent.id);
        const model = agent.behavior.model;
        this.options.catalog.agents.set(id, { ...agent, id, behavior: { ...agent.behavior, ...(model && model_references.has(model) ? { model: model_references.get(model)! } : {}) } });
        run.agent_ids.push(id);
      }
      for (const federation of project.federations ?? []) {
        const id = extension_entry_id(record.extension_id, "federation", federation.id);
        this.options.catalog.federations.set(id, federation);
        run.federation_ids.push(id);
      }
      run.power_batch.publish();
      this.options.refresh_agents?.(record.extension_id);
      run.published = true;
      run.gate.open();
      this.options.invalidate();
      return { powers: run.power_ids.length, agents: run.agent_ids.length, models: run.model_ids.length, federations: run.federation_ids.length };
    } catch (error) {
      controller.abort();
      // 新运行未曾发布，不存在合法在途调用；失败清理仍需按唯一 owner 释放。
      await this.release(record.extension_id);
      throw error;
    }
  }
}

/** 扩展仅使用 City 唯一 Town，不读取全局连接或创建平行目录。 */
function get_town(city: import("../../city/runtime/City.js").City) { return city.town; }

/** 在初始化或发布任何条目前校验全部导出与各类型本地 ID。 */
function validate_project(value: unknown): ExtensionProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ExtensionFailure("exports_invalid", "Entry must default export a project object or one configuration function", "load", 2);
  const project = value as ExtensionProject;
  if (Object.keys(value).some((key) => !["powers", "agents", "models", "federations"].includes(key))) throw new ExtensionFailure("exports_invalid", "Project contains unknown export fields", "load", 2);
  let total = 0;
  for (const kind of ["powers", "agents", "models", "federations"] as const) {
    const entries = project[kind];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) throw new ExtensionFailure("exports_invalid", `${kind} must be an array`, "load", 2);
    const ids = new Set<string>();
    for (const entry of entries) {
      const id = kind === "powers" ? (entry as NonNullable<ExtensionProject["powers"]>[number])?.name : (entry as { /** 原始本地条目身份。 */ id?: string })?.id;
      if (typeof id !== "string" || !id.trim() || ids.has(id)) throw new ExtensionFailure("duplicate_or_invalid_id", `${kind} requires unique nonempty local IDs`, "load", 2);
      ids.add(id);
      if (kind === "powers" && (typeof entry.compile_tool !== "function" || typeof entry.compile_hooks !== "function")) throw new ExtensionFailure("exports_invalid", "Power must implement the SDK Power protocol", "load", 2);
      if (kind === "models" && (typeof entry.stream !== "function" || !Number.isSafeInteger(entry.context_window) || Number(entry.context_window) <= 0)) throw new ExtensionFailure("exports_invalid", "Text models require stream() and a positive context_window", "load", 2);
      if (kind === "federations" && !(entry instanceof Downtown)) throw new ExtensionFailure("sdk_incompatible", "Federation must use the host SDK instance", "load", 2);
      if (kind === "agents") {
        const behavior = entry.behavior;
        if (!behavior || typeof behavior !== "object" || Object.keys(behavior).some((key) => !["instruction", "tools", "hooks", "session_class", "session_composer", "model"].includes(key))) throw new ExtensionFailure("exports_invalid", "Agent definition must provide only supported behavior fields", "load", 2);
      }
      total++;
    }
  }
  if (!total) throw new ExtensionFailure("exports_empty", "This project exports no loadable capabilities", "load", 2);
  return project;
}
