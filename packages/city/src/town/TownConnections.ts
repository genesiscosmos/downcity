/**
 * Town 连接注册事实源。每条注册独立管理 revision、身份和执行门禁；
 * 退登记释放 Town 的长期借用，不 dispose 宿主实例，也不操作其他连接。
 */
import { randomUUID } from "node:crypto";
import type { Downtown, FederationUser } from "@downcity/downtown";
import { assert_connection_id } from "./ResourceId.js";
import { ExecutionLease, TownError, guarded_user } from "./ExecutionLease.js";
import type { TownConnection, TownRegistrationOptions, TownRegistration, TownSource, TownUser } from "./types/Town.js";

/** 包内执行句柄；原始客户端不进入 Power 或公开连接投影。 */
export interface TownConnectionState {
  /** 对外的不可变非秘密事实。 */
  source: TownSource;
  /** 带 City 标签但没有公开出去的用户视图。 */
  user: FederationUser;
  /** 按目标连接计数的门禁。 */
  gate: ExecutionLease;
  /** 公开用户能力经过额外门禁。 */
  view: TownConnection;
  /** 退登记释放此借用；客户端最终释放仍归宿主。 */
  release: () => void;
}

/** 目录和执行共用的连接集合；目录失败不从集合删除来源。 */
export class TownConnections {
  private readonly entries = new Map<string, TownConnectionState>();
  private readonly revisions = new Map<string, number>();
  private closed = false;

  constructor(private readonly city_id: string) {}

  add(connection_id: string, client: Downtown, options: TownRegistrationOptions = {}): TownConnection {
    this.assert_open();
    if (this.entries.has(connection_id)) throw new TownError("town_connection_exists");
    const state = this.create(connection_id, client, options);
    this.entries.set(connection_id, state);
    return state.view;
  }

  get(connection_id: string): TownConnection {
    return this.require(connection_id).view;
  }

  list(): TownConnection[] { this.assert_open(); return [...this.entries.values()].map((entry) => entry.view); }

  require(connection_id: string): TownConnectionState {
    this.assert_open();
    const state = this.entries.get(connection_id);
    if (!state) throw new TownError("town_connection_not_found");
    return state;
  }

  /** 发布目录结果之前再核对注册对象，丢弃身份变化前的响应。 */
  assert_current(state: TownConnectionState): void {
    if (this.require(state.source.connection_id) !== state) throw new TownError("town_connection_changed");
  }

  /** 旧句柄绑定身份和代次；重新登录同主体时允许惰性句柄获取新注册，但旧用户视图失效。 */
  acquire(state: TownConnectionState): () => void {
    this.assert_current(state);
    return state.gate.acquire();
  }

  rename(connection_id: string, name: string): TownConnection {
    const state = this.require(connection_id);
    if (typeof name !== "string" || !name.trim()) throw new TypeError("town_connection_name_required");
    state.source = Object.freeze({ ...state.source, name: name.trim() });
    state.view = Object.freeze({ ...state.source, user: state.view.user });
    return state.view;
  }

  async replace(connection_id: string, registration: TownRegistration, expected_revision?: number, persist?: () => Promise<void>): Promise<TownConnection> {
    const previous = this.require(connection_id);
    if (expected_revision !== undefined && previous.source.revision !== expected_revision) throw new TownError("town_connection_changed");
    if (registration.client.url !== previous.source.endpoint_url && registration.auth_scope_id === previous.source.auth_scope_id) {
      throw new TownError("town_endpoint_requires_new_identity");
    }
    const end_change = previous.gate.begin_change();
    let next: TownConnectionState | undefined;
    try {
      next = this.create(connection_id, registration.client, { name: previous.source.name, ...registration });
      await persist?.();
      this.assert_current(previous);
      this.entries.set(connection_id, next);
      previous.gate.close();
      previous.release();
      return next.view;
    } catch (error) { next?.release(); throw error; }
    finally { end_change(); }
  }

  async remove(connection_id: string): Promise<TownConnection> {
    const previous = this.require(connection_id);
    const end_change = previous.gate.begin_change();
    try {
      previous.gate.close();
      this.entries.delete(connection_id);
      previous.release();
      return previous.view;
    } finally { end_change(); }
  }

  /** City 先停止其 Agent 与 Power，再关闭 Town；外部未收口请求仍会明确报 busy。 */
  async close(): Promise<void> {
    const releases: Array<() => void> = [];
    try {
      for (const state of this.entries.values()) releases.push(state.gate.begin_change());
      this.closed = true;
      for (const state of this.entries.values()) { state.gate.close(); state.release(); }
      this.entries.clear();
    } finally { for (const release of releases) release(); }
  }

  private create(connection_id: string, client: Downtown, options: TownRegistrationOptions): TownConnectionState {
    assert_connection_id(connection_id);
    const scope = options.auth_scope_id ?? `ephemeral:${randomUUID()}`;
    if (!scope || scope !== scope.trim()) throw new TypeError("town_invalid_auth_scope");
    if (options.durable && !options.auth_scope_id) throw new TypeError("town_durable_identity_required");
    const release = client.retain();
    try {
      const revision = (this.revisions.get(connection_id) ?? 0) + 1;
      const source: TownSource = Object.freeze({
        connection_id, name: options.name?.trim() || client.name, endpoint_url: client.url,
        auth_scope_id: scope, revision, durable: options.durable === true,
      });
      const gate = new ExecutionLease();
      const user = client.user.with_city(this.city_id);
      const state: TownConnectionState = { source, user, gate, release, view: undefined as unknown as TownConnection };
      const controlled = guarded_user(user, () => this.acquire(state));
      // 仅暴露普通用户能力；不把 SDK 客户端、凭据或管理员访问器放进投影。
      const public_user: TownUser = Object.freeze({
        get ai() { return controlled.ai; }, get payment() { return controlled.payment; }, get relay() { return controlled.relay; },
        account: Object.freeze({ providers: () => controlled.account.providers() }),
        current: () => controlled.current(), service: (id: string) => controlled.service(id),
        list_services: () => controlled.list_services(), describe_service: (id: string) => controlled.describe_service(id),
        openapi: () => controlled.openapi(),
      });
      state.view = Object.freeze({ ...source, user: public_user });
      this.revisions.set(connection_id, revision);
      return state;
    } catch (error) { release(); throw error; }
  }

  private assert_open(): void { if (this.closed) throw new TownError("town_closed"); }
}
