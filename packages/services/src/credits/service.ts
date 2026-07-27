/**
 * Federation Credits 服务。
 *
 * 服务以 Primary Card 和 Ephemeral Card 持有当前余额，以 Transaction 和 Entry
 * 记录不可变账务事实。所有多表变更都在 SQLite/D1 原子事务中提交。
 */

import { InstallableService, httpError, type ServiceInstallContext } from "@downcity/city";
import { raw_all, raw_atomic, raw_first } from "./raw.js";
import {
  EPHEMERAL_CARD_TABLE,
  PRIMARY_CARD_TABLE,
  TRANSACTION_ENTRY_TABLE,
  TRANSACTION_TABLE,
  creditsEphemeralCards,
  creditsPrimaryCards,
  creditsTransactionEntries,
  creditsTransactions,
} from "./schema.js";
import type {
  CreditsCardsView,
  CreditsCardReference,
  CreditsEphemeralCard,
  CreditsPrimaryCard,
  CreditsSummary,
} from "./types/Card.js";
import type {
  CreditsChargeInput,
  CreditsEphemeralCardCreateInput,
  CreditsEphemeralCardQuery,
  CreditsTopupInput,
  CreditsUserQuery,
} from "./types/Input.js";
import type {
  CreditsHistoryQuery,
  CreditsTransaction,
  CreditsTransactionEntry,
  CreditsTransactionKind,
  CreditsTransactionQuery,
} from "./types/Transaction.js";
import type { CreditsRawCommand } from "./types/RawDatabase.js";
import {
  parse_ephemeral_card,
  parse_primary_card,
  parse_transaction,
  parse_transaction_entry,
  random_id,
  read_credits,
  read_limit,
  read_required_text,
  read_text,
  stable_id,
  stringify_json,
} from "./utils.js";
import { register_credits_routes } from "./routes.js";

interface CardAllocation {
  /** Card 类型。 */
  card_kind: "primary" | "ephemeral";
  /** Primary 使用 user_id，Ephemeral 使用 card_id。 */
  card_id: string;
  /** Card 所属用户 ID。 */
  user_id: string;
  /** 本次从 Card 扣除的正数额度。 */
  credits: number;
}

interface TransactionRequest {
  /** Transaction 类型。 */
  kind: CreditsTransactionKind;
  /** 用户 ID。 */
  user_id: string;
  /** 正数总额度。 */
  credits: number;
  /** 幂等键。 */
  idempotency_key: string;
  /** 标准化请求 JSON。 */
  request_json: string;
  /** 业务来源。 */
  source: string;
  /** 外部引用。 */
  ref: string;
  /** 说明。 */
  note: string;
  /** 审计信息。 */
  metadata_json: string;
}

/** Credits 服务实例。 */
export class CreditsService extends InstallableService {
  readonly id = "credits";
  readonly name = "Credits";
  readonly version = "0.1.0";
  readonly schema = {
    primary_cards: creditsPrimaryCards,
    ephemeral_cards: creditsEphemeralCards,
    transactions: creditsTransactions,
    transaction_entries: creditsTransactionEntries,
  };

  /** Card 管理 facade。 */
  readonly cards = {
    get_primary: (user_id: string) => this.get_primary_card(user_id),
    get_ephemeral: (card_id: string) => this.get_ephemeral_card(card_id),
    list_ephemeral: (query: CreditsEphemeralCardQuery = {}) => this.list_ephemeral_cards(query),
    create_ephemeral: (input: CreditsEphemeralCardCreateInput) => this.create_ephemeral_card(input),
  };

  constructor() {
    super();
    this.instruction = [
      "提供用户级 Credits、永久 Primary Card 与限时 Ephemeral Card。",
      "Topup 给指定 Card 入账；Charge 默认优先消费最早到期的 Ephemeral Card，再消费 Primary Card。",
      "所有写操作使用 Transaction 和 Transaction Entries 原子、幂等记账，任何 Card 都不能透支。",
    ].join("\n");
  }

  install(ctx: ServiceInstallContext): void {
    register_credits_routes(this, ctx);
  }

  /** 初始化动态建表器尚未覆盖的索引与数据库级余额约束。 */
  override async _onInit(): Promise<void> {
    await raw_atomic(this.resolve_raw(), [
      { sql: `CREATE UNIQUE INDEX IF NOT EXISTS service_credits_transactions_kind_idempotency_idx ON ${TRANSACTION_TABLE} (kind, idempotency_key)`, params: [] },
      { sql: `CREATE INDEX IF NOT EXISTS service_credits_transactions_user_created_idx ON ${TRANSACTION_TABLE} (user_id, created_at)`, params: [] },
      { sql: `CREATE INDEX IF NOT EXISTS service_credits_ephemeral_cards_user_expires_idx ON ${EPHEMERAL_CARD_TABLE} (user_id, expires_at)`, params: [] },
      { sql: `CREATE INDEX IF NOT EXISTS service_credits_transaction_entries_transaction_idx ON ${TRANSACTION_ENTRY_TABLE} (transaction_id)`, params: [] },
      { sql: `CREATE INDEX IF NOT EXISTS service_credits_transaction_entries_user_created_idx ON ${TRANSACTION_ENTRY_TABLE} (user_id, created_at)`, params: [] },
      {
        sql: `CREATE TRIGGER IF NOT EXISTS service_credits_primary_cards_nonnegative_insert BEFORE INSERT ON ${PRIMARY_CARD_TABLE} WHEN NEW.credits < 0 BEGIN SELECT RAISE(ABORT, 'primary card credits cannot be negative'); END`,
        params: [],
      },
      {
        sql: `CREATE TRIGGER IF NOT EXISTS service_credits_primary_cards_nonnegative_update BEFORE UPDATE OF credits ON ${PRIMARY_CARD_TABLE} WHEN NEW.credits < 0 BEGIN SELECT RAISE(ABORT, 'primary card credits cannot be negative'); END`,
        params: [],
      },
      {
        sql: `CREATE TRIGGER IF NOT EXISTS service_credits_ephemeral_cards_nonnegative_insert BEFORE INSERT ON ${EPHEMERAL_CARD_TABLE} WHEN NEW.credits < 0 BEGIN SELECT RAISE(ABORT, 'ephemeral card credits cannot be negative'); END`,
        params: [],
      },
      {
        sql: `CREATE TRIGGER IF NOT EXISTS service_credits_ephemeral_cards_nonnegative_update BEFORE UPDATE OF credits ON ${EPHEMERAL_CARD_TABLE} WHEN NEW.credits < 0 BEGIN SELECT RAISE(ABORT, 'ephemeral card credits cannot be negative'); END`,
        params: [],
      },
    ]);
  }

  /** 读取用户 Credits 汇总。 */
  async read(user_id: string): Promise<CreditsSummary> {
    const normalized_user_id = read_required_text(user_id, "user_id");
    const primary = await this.get_primary_card(normalized_user_id);
    const current_time = new Date().toISOString();
    const row = await raw_first<Record<string, unknown>>(this.resolve_raw(), [
      "SELECT COALESCE(SUM(credits), 0) AS ephemeral_credits,",
      "MIN(CASE WHEN credits > 0 THEN expires_at END) AS next_expiration_at,",
      "SUM(CASE WHEN credits > 0 THEN 1 ELSE 0 END) AS active_ephemeral_cards",
      `FROM ${EPHEMERAL_CARD_TABLE}`,
      "WHERE user_id = ? AND expires_at > ?",
    ].join(" "), [normalized_user_id, current_time]);
    const ephemeral_credits = Number(row?.ephemeral_credits ?? 0);
    return {
      user_id: normalized_user_id,
      primary_credits: primary.credits,
      ephemeral_credits,
      available_credits: primary.credits + ephemeral_credits,
      next_expiration_at: row?.next_expiration_at ? String(row.next_expiration_at) : null,
      active_ephemeral_cards: Number(row?.active_ephemeral_cards ?? 0),
    };
  }

  /** 读取用户全部 Card。 */
  async read_cards(user_id: string, include_history = false): Promise<CreditsCardsView> {
    const normalized_user_id = read_required_text(user_id, "user_id");
    const [primary, ephemeral] = await Promise.all([
      this.get_primary_card(normalized_user_id),
      this.list_ephemeral_cards({ user_id: normalized_user_id, include_history }),
    ]);
    return { primary, ephemeral };
  }

  /** 检查用户是否具有最低可用额度。 */
  async precheck(user_id: string, needed_credits = 1): Promise<CreditsSummary> {
    const needed = read_credits(needed_credits, "needed_credits");
    const summary = await this.read(user_id);
    if (summary.available_credits < needed) {
      throw httpError(402, `insufficient credits: need ${needed}, current ${summary.available_credits}`);
    }
    return summary;
  }

  /** 查询已建立 Primary Card 的 Credits 用户。 */
  async list_users(query: CreditsUserQuery = {}): Promise<CreditsSummary[]> {
    const rows = await raw_all<Record<string, unknown>>(this.resolve_raw(), [
      `SELECT user_id FROM ${PRIMARY_CARD_TABLE}`,
      "ORDER BY created_at DESC, rowid DESC LIMIT ?",
    ].join(" "), [read_limit(query.limit)]);
    return await Promise.all(rows.map((row) => this.read(String(row.user_id))));
  }

  /** 创建 Ephemeral Card，并原子写入初始 Topup。 */
  async create_ephemeral_card(input: CreditsEphemeralCardCreateInput): Promise<CreditsEphemeralCard> {
    const user_id = read_required_text(input.user_id, "user_id");
    const name = read_required_text(input.name, "name");
    const credits = read_credits(input.initial_credits, "initial_credits");
    const expires_at = read_required_text(input.expires_at, "expires_at");
    if (!Number.isFinite(Date.parse(expires_at)) || Date.parse(expires_at) <= Date.now()) {
      throw new TypeError("expires_at must be a future ISO timestamp");
    }
    const request = this.create_transaction_request("topup", {
      user_id,
      credits,
      idempotency_key: input.idempotency_key,
      source: input.source,
      ref: input.ref,
      note: input.note,
      metadata: input.metadata,
      request: { mode: "create_ephemeral", user_id, name, credits, expires_at },
    });
    const existing = await this.read_idempotent_transaction(request);
    if (existing) return await this.read_ephemeral_from_transaction(existing.transaction_id);

    const transaction_id = await this.create_transaction_id(request.kind, request.idempotency_key);
    const card_id = random_id("card");
    const now = new Date().toISOString();
    await raw_atomic(this.resolve_raw(), [
      this.insert_transaction_command(transaction_id, request, now),
      {
        sql: [
          `INSERT INTO ${EPHEMERAL_CARD_TABLE}`,
          "(card_id, user_id, name, credits, expires_at, source, ref, transaction_marker, created_at, updated_at)",
          "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?",
          `WHERE EXISTS (SELECT 1 FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'pending')`,
        ].join(" "),
        params: [card_id, user_id, name, credits, expires_at, request.source, request.ref, transaction_id, now, now, transaction_id],
      },
      this.insert_entry_from_card_command(transaction_id, 0, "ephemeral", card_id, credits, now),
      this.apply_transaction_command(transaction_id, credits, 1, now),
      {
        sql: `DELETE FROM ${EPHEMERAL_CARD_TABLE} WHERE card_id = ? AND transaction_marker = ? AND EXISTS (SELECT 1 FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'pending')`,
        params: [card_id, transaction_id, transaction_id],
      },
      ...this.cleanup_pending_transaction_commands(transaction_id),
      this.clear_marker_command("ephemeral", card_id, transaction_id),
    ]);
    const transaction = await this.read_idempotent_transaction(request);
    if (!transaction) throw httpError(409, "ephemeral card creation could not be applied");
    return await this.read_ephemeral_from_transaction(transaction.transaction_id);
  }

  /** 给指定 Card 增加额度。 */
  async topup(input: CreditsTopupInput): Promise<CreditsTransaction> {
    const credits = read_credits(input.credits);
    const request_json = JSON.stringify({ card: input.card, credits });
    const existing = await this.read_idempotent_transaction_by_key("topup", input.idempotency_key, request_json);
    if (existing) return existing;
    const card = await this.resolve_card(input.card);
    const request = this.create_transaction_request("topup", {
      user_id: card.user_id,
      credits,
      idempotency_key: input.idempotency_key,
      source: input.source,
      ref: input.ref,
      note: input.note,
      metadata: input.metadata,
      request: { card: input.card, credits },
    });
    const transaction_id = await this.create_transaction_id(request.kind, request.idempotency_key);
    const now = new Date().toISOString();
    await raw_atomic(this.resolve_raw(), [
      this.insert_transaction_command(transaction_id, request, now),
      this.update_card_command(transaction_id, card.kind, card.card_id, credits, "topup", now),
      this.insert_entry_from_card_command(transaction_id, 0, card.kind, card.card_id, credits, now),
      this.apply_transaction_command(transaction_id, credits, 1, now),
      this.rollback_card_command(transaction_id, card.kind, card.card_id, credits, "topup", now),
      ...this.cleanup_pending_transaction_commands(transaction_id),
      this.clear_marker_command(card.kind, card.card_id, transaction_id),
    ]);
    const transaction = await this.read_idempotent_transaction(request);
    if (!transaction) throw httpError(409, "target card is expired or changed concurrently");
    return transaction;
  }

  /** 从用户的一张或多张 Card 消费额度。 */
  async charge(input: CreditsChargeInput): Promise<CreditsTransaction> {
    const user_id = read_required_text(input.user_id, "user_id");
    const credits = read_credits(input.credits);
    const request = this.create_transaction_request("charge", {
      user_id,
      credits,
      idempotency_key: input.idempotency_key,
      source: input.source,
      ref: input.ref,
      note: input.note,
      metadata: input.metadata,
      request: { user_id, credits, card: input.card ?? null },
    });
    const existing = await this.read_idempotent_transaction(request);
    if (existing) return existing;
    const allocations = input.card
      ? await this.allocate_selected_card(user_id, input.card, credits)
      : await this.allocate_cards(user_id, credits);
    const transaction_id = await this.create_transaction_id(request.kind, request.idempotency_key);
    const now = new Date().toISOString();
    const commands: CreditsRawCommand[] = [this.insert_transaction_command(transaction_id, request, now)];
    allocations.forEach((allocation, index) => {
      commands.push(
        this.update_card_command(transaction_id, allocation.card_kind, allocation.card_id, allocation.credits, "charge", now),
        this.insert_entry_from_card_command(transaction_id, index, allocation.card_kind, allocation.card_id, -allocation.credits, now),
      );
    });
    commands.push(this.apply_transaction_command(transaction_id, -credits, allocations.length, now));
    allocations.forEach((allocation) => {
      commands.push(this.rollback_card_command(transaction_id, allocation.card_kind, allocation.card_id, allocation.credits, "charge", now));
    });
    commands.push(...this.cleanup_pending_transaction_commands(transaction_id));
    allocations.forEach((allocation) => {
      commands.push(this.clear_marker_command(allocation.card_kind, allocation.card_id, transaction_id));
    });
    await raw_atomic(this.resolve_raw(), commands);
    const transaction = await this.read_idempotent_transaction(request);
    if (!transaction) {
      const summary = await this.read(user_id);
      if (summary.available_credits < credits) throw httpError(402, "insufficient credits");
      throw httpError(409, "credits changed concurrently; retry the charge");
    }
    return transaction;
  }

  /** 按条件查询 Transactions。 */
  async list_transactions(query: CreditsTransactionQuery = {}): Promise<CreditsTransaction[]> {
    const clauses: string[] = ["status = 'applied'"];
    const params: unknown[] = [];
    if (query.user_id) {
      clauses.push("user_id = ?");
      params.push(read_required_text(query.user_id, "user_id"));
    }
    if (query.kind) {
      clauses.push("kind = ?");
      params.push(read_required_text(query.kind, "kind"));
    }
    const rows = await raw_all<Record<string, unknown>>(this.resolve_raw(), [
      `SELECT * FROM ${TRANSACTION_TABLE}`,
      `WHERE ${clauses.join(" AND ")}`,
      "ORDER BY created_at DESC, rowid DESC LIMIT ?",
    ].join(" "), [...params, read_limit(query.limit)]);
    return rows.map(parse_transaction);
  }

  /** 按 ID 读取 Transaction。 */
  async get_transaction(transaction_id: string): Promise<CreditsTransaction> {
    const row = await raw_first<Record<string, unknown>>(this.resolve_raw(),
      `SELECT * FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'applied'`,
      [read_required_text(transaction_id, "transaction_id")]);
    if (!row) throw httpError(404, "credits transaction not found");
    return parse_transaction(row);
  }

  /** 查询不可变 Card 流水。 */
  async history(query: CreditsHistoryQuery = {}): Promise<CreditsTransactionEntry[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.user_id) {
      clauses.push("user_id = ?");
      params.push(read_required_text(query.user_id, "user_id"));
    }
    if (query.transaction_id) {
      clauses.push("transaction_id = ?");
      params.push(read_required_text(query.transaction_id, "transaction_id"));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await raw_all<Record<string, unknown>>(this.resolve_raw(), [
      `SELECT * FROM ${TRANSACTION_ENTRY_TABLE}`,
      where,
      "ORDER BY created_at DESC, rowid DESC LIMIT ?",
    ].join(" "), [...params, read_limit(query.limit)]);
    return rows.map(parse_transaction_entry);
  }

  private async get_primary_card(user_id: string): Promise<CreditsPrimaryCard> {
    const normalized_user_id = read_required_text(user_id, "user_id");
    const now = new Date().toISOString();
    await raw_atomic(this.resolve_raw(), [{
      sql: `INSERT OR IGNORE INTO ${PRIMARY_CARD_TABLE} (user_id, credits, transaction_marker, created_at, updated_at) VALUES (?, 0, '', ?, ?)`,
      params: [normalized_user_id, now, now],
    }]);
    const row = await raw_first<Record<string, unknown>>(this.resolve_raw(),
      `SELECT user_id, credits, created_at, updated_at FROM ${PRIMARY_CARD_TABLE} WHERE user_id = ?`,
      [normalized_user_id]);
    if (!row) throw httpError(500, "primary card could not be created");
    return parse_primary_card(row);
  }

  private async get_ephemeral_card(card_id: string): Promise<CreditsEphemeralCard> {
    const row = await raw_first<Record<string, unknown>>(this.resolve_raw(),
      `SELECT card_id, user_id, name, credits, expires_at, source, ref, created_at, updated_at FROM ${EPHEMERAL_CARD_TABLE} WHERE card_id = ?`,
      [read_required_text(card_id, "card_id")]);
    if (!row) throw httpError(404, "ephemeral card not found");
    return parse_ephemeral_card(row);
  }

  private async list_ephemeral_cards(query: CreditsEphemeralCardQuery): Promise<CreditsEphemeralCard[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.user_id) {
      clauses.push("user_id = ?");
      params.push(read_required_text(query.user_id, "user_id"));
    }
    if (!query.include_history) {
      clauses.push("expires_at > ?");
      clauses.push("credits > 0");
      params.push(new Date().toISOString());
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await raw_all<Record<string, unknown>>(this.resolve_raw(), [
      `SELECT card_id, user_id, name, credits, expires_at, source, ref, created_at, updated_at FROM ${EPHEMERAL_CARD_TABLE}`,
      where,
      "ORDER BY CASE WHEN expires_at > ? AND credits > 0 THEN 0 WHEN credits = 0 THEN 1 ELSE 2 END, expires_at ASC LIMIT ?",
    ].join(" "), [...params, new Date().toISOString(), read_limit(query.limit)]);
    return rows.map(parse_ephemeral_card);
  }

  private async resolve_card(reference: CreditsCardReference): Promise<{ kind: "primary" | "ephemeral"; card_id: string; user_id: string; credits: number }> {
    if (reference.kind === "primary") {
      const card = await this.get_primary_card(reference.user_id);
      return { kind: "primary", card_id: card.user_id, user_id: card.user_id, credits: card.credits };
    }
    const card = await this.get_ephemeral_card(reference.card_id);
    if (card.status === "expired") throw httpError(409, "ephemeral card is expired");
    return { kind: "ephemeral", card_id: card.card_id, user_id: card.user_id, credits: card.credits };
  }

  private async allocate_selected_card(user_id: string, reference: CreditsCardReference, credits: number): Promise<CardAllocation[]> {
    const card = await this.resolve_card(reference);
    if (card.user_id !== user_id) throw httpError(403, "card does not belong to user");
    if (card.credits < credits) throw httpError(402, "insufficient credits on selected card");
    return [{ card_kind: card.kind, card_id: card.card_id, user_id, credits }];
  }

  private async allocate_cards(user_id: string, credits: number): Promise<CardAllocation[]> {
    const [ephemeral, primary] = await Promise.all([
      this.list_ephemeral_cards({ user_id, include_history: false, limit: 500 }),
      this.get_primary_card(user_id),
    ]);
    let remaining = credits;
    const allocations: CardAllocation[] = [];
    for (const card of ephemeral) {
      if (remaining <= 0) break;
      const amount = Math.min(card.credits, remaining);
      if (amount > 0) allocations.push({ card_kind: "ephemeral", card_id: card.card_id, user_id, credits: amount });
      remaining -= amount;
    }
    if (remaining > 0 && primary.credits > 0) {
      const amount = Math.min(primary.credits, remaining);
      allocations.push({ card_kind: "primary", card_id: user_id, user_id, credits: amount });
      remaining -= amount;
    }
    if (remaining > 0) throw httpError(402, "insufficient credits");
    return allocations;
  }

  private create_transaction_request(
    kind: CreditsTransactionKind,
    input: {
      user_id: string;
      credits: number;
      idempotency_key: string;
      source: string;
      ref?: string;
      note?: string;
      metadata?: Record<string, unknown>;
      request: Record<string, unknown>;
    },
  ): TransactionRequest {
    return {
      kind,
      user_id: input.user_id,
      credits: input.credits,
      idempotency_key: read_required_text(input.idempotency_key, "idempotency_key"),
      request_json: JSON.stringify(input.request),
      source: read_required_text(input.source, "source"),
      ref: read_text(input.ref),
      note: read_text(input.note),
      metadata_json: stringify_json(input.metadata),
    };
  }

  private async read_idempotent_transaction(request: TransactionRequest): Promise<CreditsTransaction | undefined> {
    return await this.read_idempotent_transaction_by_key(request.kind, request.idempotency_key, request.request_json);
  }

  private async read_idempotent_transaction_by_key(
    kind: CreditsTransactionKind,
    idempotency_key: string,
    request_json: string,
  ): Promise<CreditsTransaction | undefined> {
    const normalized_idempotency_key = read_required_text(idempotency_key, "idempotency_key");
    const transaction_id = await this.create_transaction_id(kind, normalized_idempotency_key);
    const row = await raw_first<Record<string, unknown>>(this.resolve_raw(),
      `SELECT * FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'applied'`,
      [transaction_id]);
    if (!row) return undefined;
    if (String(row.request_json ?? "") !== request_json) {
      throw httpError(409, "idempotency_key was already used with different parameters");
    }
    return parse_transaction(row);
  }

  /** Transaction ID 由类型与幂等键稳定派生，使主键本身成为并发幂等边界。 */
  private create_transaction_id(kind: CreditsTransactionKind, idempotency_key: string): Promise<string> {
    return stable_id("ctx", `${kind}:${idempotency_key}`);
  }

  private async read_ephemeral_from_transaction(transaction_id: string): Promise<CreditsEphemeralCard> {
    const entry = await raw_first<Record<string, unknown>>(this.resolve_raw(),
      `SELECT card_id FROM ${TRANSACTION_ENTRY_TABLE} WHERE transaction_id = ? AND card_kind = 'ephemeral' LIMIT 1`,
      [transaction_id]);
    if (!entry) throw httpError(500, "ephemeral card transaction has no entry");
    return await this.get_ephemeral_card(String(entry.card_id));
  }

  private insert_transaction_command(transaction_id: string, request: TransactionRequest, now: string): CreditsRawCommand {
    return {
      sql: [
        `INSERT OR IGNORE INTO ${TRANSACTION_TABLE}`,
        "(transaction_id, kind, user_id, credits, status, idempotency_key, request_json, source, ref, note, metadata_json, created_at, applied_at)",
        "VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, '')",
      ].join(" "),
      params: [transaction_id, request.kind, request.user_id, request.credits, request.idempotency_key, request.request_json, request.source, request.ref, request.note, request.metadata_json, now],
    };
  }

  private update_card_command(
    transaction_id: string,
    kind: "primary" | "ephemeral",
    card_id: string,
    credits: number,
    operation: "topup" | "charge",
    now: string,
  ): CreditsRawCommand {
    const table = kind === "primary" ? PRIMARY_CARD_TABLE : EPHEMERAL_CARD_TABLE;
    const key = kind === "primary" ? "user_id" : "card_id";
    const delta = operation === "topup" ? credits : -credits;
    const sufficient = operation === "charge" ? "AND credits >= ?" : "";
    const unexpired = kind === "ephemeral" ? "AND expires_at > ?" : "";
    const params: unknown[] = [delta, transaction_id, now, card_id];
    if (operation === "charge") params.push(credits);
    if (kind === "ephemeral") params.push(now);
    params.push(transaction_id);
    return {
      sql: [
        `UPDATE ${table} SET credits = credits + ?, transaction_marker = ?, updated_at = ?`,
        `WHERE ${key} = ? ${sufficient} ${unexpired}`,
        `AND EXISTS (SELECT 1 FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'pending')`,
      ].join(" "),
      params,
    };
  }

  private insert_entry_from_card_command(
    transaction_id: string,
    index: number,
    kind: "primary" | "ephemeral",
    card_id: string,
    delta: number,
    now: string,
  ): CreditsRawCommand {
    const table = kind === "primary" ? PRIMARY_CARD_TABLE : EPHEMERAL_CARD_TABLE;
    const key = kind === "primary" ? "user_id" : "card_id";
    const user_column = "user_id";
    return {
      sql: [
        `INSERT INTO ${TRANSACTION_ENTRY_TABLE}`,
        "(entry_id, transaction_id, user_id, card_kind, card_id, credits_delta, credits_after, created_at)",
        `SELECT ?, ?, ${user_column}, ?, ?, ?, credits, ? FROM ${table}`,
        `WHERE ${key} = ? AND transaction_marker = ?`,
        `AND EXISTS (SELECT 1 FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'pending')`,
      ].join(" "),
      params: [`cte_${transaction_id}_${index}`, transaction_id, kind, card_id, delta, now, card_id, transaction_id, transaction_id],
    };
  }

  private apply_transaction_command(transaction_id: string, expected_delta: number, entry_count: number, now: string): CreditsRawCommand {
    return {
      sql: [
        `UPDATE ${TRANSACTION_TABLE} SET status = 'applied', applied_at = ?`,
        "WHERE transaction_id = ? AND status = 'pending'",
        `AND (SELECT COUNT(*) FROM ${TRANSACTION_ENTRY_TABLE} WHERE transaction_id = ?) = ?`,
        `AND (SELECT COALESCE(SUM(credits_delta), 0) FROM ${TRANSACTION_ENTRY_TABLE} WHERE transaction_id = ?) = ?`,
      ].join(" "),
      params: [now, transaction_id, transaction_id, entry_count, transaction_id, expected_delta],
    };
  }

  private rollback_card_command(
    transaction_id: string,
    kind: "primary" | "ephemeral",
    card_id: string,
    credits: number,
    operation: "topup" | "charge",
    now: string,
  ): CreditsRawCommand {
    const table = kind === "primary" ? PRIMARY_CARD_TABLE : EPHEMERAL_CARD_TABLE;
    const key = kind === "primary" ? "user_id" : "card_id";
    const rollback_delta = operation === "topup" ? -credits : credits;
    return {
      sql: [
        `UPDATE ${table} SET credits = credits + ?, updated_at = ?`,
        `WHERE ${key} = ? AND transaction_marker = ?`,
        `AND EXISTS (SELECT 1 FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'pending')`,
      ].join(" "),
      params: [rollback_delta, now, card_id, transaction_id, transaction_id],
    };
  }

  private cleanup_pending_transaction_commands(transaction_id: string): CreditsRawCommand[] {
    return [
      {
        sql: `DELETE FROM ${TRANSACTION_ENTRY_TABLE} WHERE transaction_id = ? AND EXISTS (SELECT 1 FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'pending')`,
        params: [transaction_id, transaction_id],
      },
      {
        sql: `DELETE FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'pending'`,
        params: [transaction_id],
      },
    ];
  }

  private clear_marker_command(kind: "primary" | "ephemeral", card_id: string, transaction_id: string): CreditsRawCommand {
    const table = kind === "primary" ? PRIMARY_CARD_TABLE : EPHEMERAL_CARD_TABLE;
    const key = kind === "primary" ? "user_id" : "card_id";
    return {
      sql: `UPDATE ${table} SET transaction_marker = '' WHERE ${key} = ? AND transaction_marker = ?`,
      params: [card_id, transaction_id],
    };
  }

  private resolve_raw(): unknown {
    if (!this._raw) throw new Error("credits service raw database is not ready");
    return this._raw;
  }
}
