/**
 * MemoryPower：Agent 长期记忆的 provider-neutral facade。
 *
 * 职责说明（中文）
 * - 对 Agent 暴露稳定的 Memory actions 与 system 使用约束。
 * - 把可信 Agent/Session 上下文映射为结构化 Memory 访问上下文。
 * - 将记忆形成、存储、召回、修订和删除委托给唯一 MemoryProvider。
 *
 * 边界说明（中文）
 * - 只接受宿主显式提供的 Agent/City Memory 根路径，不猜测 City 上级目录。
 * - 不依赖 Workspace FileSystem；具体文件布局仍封装在 Provider/Adapter 内。
 * - Provider 生命周期跟随 City 持有的 MemoryPower 唯一实例。
 */
import { is_model_reference } from "@downcity/type";
import type { Command } from "commander";
import path from "node:path";
import { Power, create_action } from "@downcity/city/power";
import type {
  PowerJsonValue,
  PowerHooks,
  PowerActions,
  PowerContext,
  PowerLifecycleContext,
} from "@downcity/city/power";
import type {
  SessionSystemContextHookValue,
  SessionTurnContextHookValue,
} from "@downcity/agent";
import { SESSION_HOOK_POINTS } from "@downcity/type";
import { z } from "zod";
import { build_memory_power_system_text } from "@/memory/runtime/SystemProvider.js";
import { MemoryProfile } from "@/memory/runtime/MemoryAgreementProjection.js";
import { MemoryJobStore } from "@/memory/storage/MemoryJobStore.js";
import { MEMORY_SESSION_KIND } from "@/memory/types/MemorySession.js";
import { MemoryDeliveryStore } from "@/memory/storage/MemoryDeliveryStore.js";
import { MemoryDelivery } from "@/memory/application/MemoryDelivery.js";
import { MemoryCoordinator } from "@/memory/application/MemoryCoordinator.js";
import { MemoryService } from "@/memory/application/MemoryService.js";
import { create_memory_actions } from "./application/MemoryActions.js";
import { mark_profile_snapshot, build_profile_updates } from "@/memory/runtime/MemoryContext.js";
import { UserRepository, LOCAL_USER_ID } from "@downcity/city/local";
import type { ProfileScope } from "@/memory/types/Profile.js";
import { createHash, randomUUID } from "node:crypto";
import { BuiltinMemoryProvider } from "@/memory/providers/MemoryRecordsProvider.js";
import {
  FileMemoryStorageAdapter,
  get_default_file_memory_root_path,
} from "@/memory/adapters/FileMemoryStorageAdapter.js";
import { MemoryStorageRouter } from "@/memory/adapters/MemoryStorageRouter.js";
import { create_file_memory_legacy_probe } from "@/memory/storage/MemoryScopeLifecycle.js";

import { resolve_memory_access } from "@/memory/runtime/AccessResolver.js";
import { register_memory_management_actions } from "@/memory/host/MemoryManagementActions.js";
import type {
  MemoryPowerOptions,
  MemoryProvider,
} from "@/memory/types/MemoryProtocol.js";

import { MemorySignalStore } from "./storage/MemorySignalStore.js";
import { MemoryDreaming } from "./application/MemoryDreaming.js";
import { can_run_memory_background } from "./application/MemoryMaintenanceGate.js";
import { register_memory_dream_host_actions } from "./host/MemoryDreamHostActions.js";
import { register_memory_record_host_actions } from "./host/MemoryRecordHostActions.js";

/** Agent 长期记忆 Power。 */
export class MemoryPower extends Power {
  /** Power 稳定名称。 */
  readonly name = "memory";

  /** Power 用户可见标题。 */
  readonly title = "Memory";

  /** Power 用户可见说明。 */
  readonly description =
    "Provides provider-neutral long-term memory, recall, revision, and deletion.";

  /** 当前 City 生命周期内唯一的 Memory Provider。 */
  private provider_instance?: MemoryProvider;

  /** 宿主显式提供的平台数据根目录；用于定位 Agent 私有记忆。 */
  private readonly platform_root_path?: string;

  /** 宿主配置：专用 Session 模型与独立数据根。 */
  private readonly options: MemoryPowerOptions;

  /** User / Agent 核心记忆投影与确定性版本化编辑。 */
  private profile_runtime?: MemoryProfile;

  /** 内部请求调度与持久化记忆业务入口。 */
  private coordinator?: MemoryCoordinator;
  /** 独立可靠回传，投递失败不影响已提交的记忆。 */
  private delivery?: MemoryDelivery;
  /** 内部后台整理 Process，只处理可信事实，不占用通用 Agent 生命周期。 */
  private dreaming?: MemoryDreaming;
  /** 普通 Action 不直接调用模型，统一由应用服务处理。 */
  private service_instance?: MemoryService;
  /** 当前生命周期绑定的有界来源宿主。 */
  private host_context?: PowerLifecycleContext;

  /** 仅在 City 完成初始化后提供业务服务。 */
  private get service(): MemoryService {
    if (!this.service_instance) throw new Error("Memory service is not initialized");
    return this.service_instance;
  }

  /** 将实际结果和错误映射为 Power 返回值。 */
  private async run_action(run: () => Promise<unknown>) {
    try { return { success: true as const, data: await run() as PowerJsonValue }; }
    catch (error) { return { success: false as const, error: error instanceof Error ? error.message : String(error) }; }
  }

  constructor(options: MemoryPowerOptions = {}) {
    super();
    this.options = options;
    const shared_root_path = options.shared_root_path?.trim();
    const platform_root_path = options.platform_root_path?.trim();
    if (shared_root_path && !path.isAbsolute(shared_root_path)) {
      throw new Error("MemoryPower shared_root_path must be an absolute path");
    }
    if (platform_root_path && !path.isAbsolute(platform_root_path)) {
      throw new Error("MemoryPower platform_root_path must be an absolute path");
    }
    this.provider_instance = options.provider;
    if (shared_root_path && !this.provider_instance) {
      this.provider_instance = create_memory_provider({
        on_changed: options.on_changed,
        shared_root_path,
        ...(platform_root_path ? { platform_root_path } : {}),
      });
    }
    this.platform_root_path = platform_root_path ? path.resolve(platform_root_path) : undefined;
  }

  /** 返回已经由 City 启动的唯一 Memory Provider。 */
  get provider(): MemoryProvider {
    if (!this.provider_instance) throw new Error("MemoryPower is not started by City");
    return this.provider_instance;
  }

  /** 构建不包含 Memory 数据的 Power 使用说明。 */
  async system(context: PowerContext): Promise<string> {
    void context;
    return build_memory_power_system_text(this.provider);
  }

  /** Profile 与 Instruction 一起构建并冻结，仅首次组装和 syncshot 读取。 */
  readonly hooks: PowerHooks = {
    pipeline: {
      [SESSION_HOOK_POINTS.system_context]: [async ({ context, value }) => {
        try {
        const input = value as unknown as SessionSystemContextHookValue;
        if (context.session?.kind === MEMORY_SESSION_KIND) return value;
        await this.provider.assert_ready(resolve_memory_access(context));
        const blocks = [...input.blocks];
        const scopes: ProfileScope[] = [{ scope: "user" }, { scope: "agent", agent_id: context.agent.id }];
        for (const scope of scopes) {
          try {
            const core = await this.profile_runtime?.context_block(scope);
            if (core) blocks.push({ source: "power", name: `memory/${core.name}`, content: mark_profile_snapshot(core),
              position: scope.scope === "agent" ? "after_instruction" : "before_session" });
          } catch (error) { throw Object.assign(new Error(String(error)), { code: "SESSION_CONTEXT_REQUIRED" }); }
        }
        return { ...input, blocks } as unknown as PowerJsonValue;
        } catch (cause) { throw Object.assign(new Error(`Memory context unavailable: ${String(cause)}`, { cause }), { code: "SESSION_CONTEXT_REQUIRED" }); }
      }],
      [SESSION_HOOK_POINTS.turn_context]: [async ({ context, value }) => {
        if (!this.profile_runtime || context.session?.kind === MEMORY_SESSION_KIND) return value;
        try {
        await this.provider.assert_ready(resolve_memory_access(context));
        const input = value as unknown as SessionTurnContextHookValue;
        const updates = await build_profile_updates(this.profile_runtime, context.agent.id, input.system_blocks ?? []);
        return { ...input, blocks: [...input.blocks, ...updates] } as unknown as PowerJsonValue;
        } catch (cause) { throw Object.assign(new Error(`Memory context unavailable: ${String(cause)}`, { cause }), { code: "SESSION_CONTEXT_REQUIRED" }); }
      }],
    },
  };

  /** 启动当前 City 唯一的 Memory Provider，并注册界面管理 actions。 */
  async initialize(context: PowerLifecycleContext): Promise<void> {
    context.abort_signal.throwIfAborted();
    this.host_context = context;
    const platform_root = this.platform_root_path ?? context.data_root_path;
    const users = new UserRepository(platform_root);
    users.get();
    this.provider_instance ??= create_memory_provider({
      on_changed: this.options.on_changed,
      shared_root_path: context.storage.path,
      platform_root_path: platform_root,
    });
    context.power.action({ id: "memory.user_read", run: async () => ({ ...users.get() }) });
    context.power.action({ id: "memory.user_update", run: async (input) => {
      const { display_name } = z.object({ display_name: z.string() }).parse(input);
      return { ...users.update({ display_name }) };
    } });
    await this.provider.initialize();
    context.abort_signal.throwIfAborted();
    const config = context.config.get();
    const model = this.options.model ?? (is_model_reference(config.model) ? config.model : undefined);
    const binding_id = this.options.binding_id ?? (typeof config.binding_id === "string" ? config.binding_id : undefined);
    register_memory_management_actions(context, this.provider, model);
    this.profile_runtime = new MemoryProfile(this.provider);
    const jobs = new MemoryJobStore(path.join(context.storage.path, "processing"));
    const signals = new MemorySignalStore(path.join(platform_root, "memory", "dreaming"));
    const maintenance_owner_id = createHash("sha256").update(context.storage.path).digest("hex");
    this.coordinator = new MemoryCoordinator({ host: context, provider: this.provider,
      jobs,
      can_run_background: async (job) => await can_run_memory_background(signals, maintenance_owner_id, job),
      model, binding_id,
      resolve_model_binding: this.options.resolve_model_binding,
    });
    this.delivery = new MemoryDelivery(jobs, new MemoryDeliveryStore(path.join(context.storage.path, "delivery")),
      async (recipient, delivery_id, text) => {
        const result = await context.system.deliver_agent_session_result({ ...recipient, delivery_id, text });
        return result.status;
      }, context.logger);
    this.service_instance = new MemoryService(this.provider, jobs, this.coordinator, context, this.delivery);
    this.dreaming = new MemoryDreaming(context,
      signals, jobs, this.coordinator,
      async (scope) => ({ agent_id: scope.agent_id, workspace_id: scope.workspace_id, city_memory_available: true }),
      this.options.dreaming);
    await this.coordinator.initialize();
    context.abort_signal.throwIfAborted();
    await this.dreaming.initialize();
    context.abort_signal.throwIfAborted();
    register_memory_dream_host_actions(context, this.dreaming);
    register_memory_record_host_actions(context, this.service, jobs, this.dreaming);
    this.delivery.initialize();

  }

  /** 释放当前 City 唯一的 Memory Provider。 */
  async dispose(): Promise<void> {
    await this.dreaming?.dispose();
    this.dreaming = undefined;
    await this.delivery?.dispose();
    this.delivery = undefined;
    await this.coordinator?.dispose();
    this.coordinator = undefined;
    this.service_instance = undefined;
    await this.profile_runtime?.dispose();
    this.profile_runtime = undefined;
    await this.provider_instance?.dispose();
    this.provider_instance = undefined;
  }

  /** SDK、CLI 与普通工具共用同一个动作集合。 */
  readonly actions: PowerActions = create_memory_actions(() => this.provider, () => this.service, () => {
    if (!this.host_context) throw new Error("Memory host unavailable");
    return this.host_context;
  });

}

/** 创建内建 Memory Provider，并把 Agent 私有根与共享根路由到不同物理目录。 */
function create_memory_provider(input: {
  /** 已持久化内容的业务变更回调，不依赖调用入口。 */
  on_changed?: MemoryPowerOptions["on_changed"];
  /** City 为当前 MemoryPower 唯一实例分配的共享绝对目录。 */
  shared_root_path: string;

  /** 平台数据根目录；用于推导 `agents/<agent_id>/memory`。 */
  platform_root_path?: string;
}): MemoryProvider {
  const platform_root_path = String(input.platform_root_path || "").trim();
  if (!platform_root_path || !path.isAbsolute(platform_root_path)) {
    throw new Error(
      "MemoryPower requires an absolute platform_root_path to locate Agent private memory",
    );
  }
  return new BuiltinMemoryProvider({
    on_changed: input.on_changed,
    city_memory_available: true,
    legacy_scope_probe: create_file_memory_legacy_probe(platform_root_path),
    storage: new MemoryStorageRouter({
      shared_storage: new FileMemoryStorageAdapter({ root_path: input.shared_root_path }),
      user_storage: new FileMemoryStorageAdapter({ root_path: path.join(platform_root_path, "user", "memory") }),
      create_agent_storage: (agent_id) => new FileMemoryStorageAdapter({
        root_path: get_default_file_memory_root_path({
          platform_root_path,
          agent_id,
        }),
      }),
    }),
  });
}
