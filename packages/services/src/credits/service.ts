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
  MAX_ACTIVE_EPHEMERAL_CARDS,
  MAX_USER_CREDITS,
  random_id,
  read_credits,
  read_future_iso_timestamp,
  read_limit,
  read_required_text,
  read_text,
  stable_stringify,
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
    get_primary: async (user_id: string) => {
      const normalized_user_id = read_required_text(user_id, "user_id");
      await this.cleanup_expired_cards(normalized_user_id);
      return await this.get_primary_card(normalized_user_id);
    },
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
  protected override async on_init(): Promise<void> {
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
    await this.normalize_existing_ephemeral_expirations();
    await this.cleanup_expired_cards();
    await this.assert_existing_data_limits();
  }

  /** 读取用户 Credits 汇总。 */
  async read(user_id: string): Promise<CreditsSummary> {
    const normalized_user_id = read_required_text(user_id, "user_id");
    await this.cleanup_expired_cards(normalized_user_id);
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
    await this.cleanup_expired_cards(normalized_user_id);
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
    const expires_at = read_future_iso_timestamp(input.expires_at);
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
      this.delete_expired_cards_command(user_id, now),
      this.insert_transaction_command(transaction_id, request, now),
      {
        sql: [
          `INSERT INTO ${EPHEMERAL_CARD_TABLE}`,
          "(card_id, user_id, name, credits, expires_at, source, ref, transaction_marker, created_at, updated_at)",
          "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?",
          `WHERE EXISTS (SELECT 1 FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'pending')`,
          `AND (SELECT COUNT(*) FROM ${EPHEMERAL_CARD_TABLE} WHERE user_id = ? AND expires_at > ? AND credits > 0) < ?`,
          `AND COALESCE((SELECT credits FROM ${PRIMARY_CARD_TABLE} WHERE user_id = ?), 0)`,
          `+ COALESCE((SELECT SUM(credits) FROM ${EPHEMERAL_CARD_TABLE} WHERE user_id = ? AND expires_at > ?), 0) <= ?`,
        ].join(" "),
        params: [
          card_id,
          user_id,
          name,
          credits,
          expires_at,
          request.source,
          request.ref,
          transaction_id,
          now,
          now,
          transaction_id,
          user_id,
          now,
          MAX_ACTIVE_EPHEMERAL_CARDS,
          user_id,
          user_id,
          now,
          MAX_USER_CREDITS - credits,
        ],
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
    if (!transaction) {
      const active_count = await this.count_active_ephemeral_cards(user_id);
      if (active_count >= MAX_ACTIVE_EPHEMERAL_CARDS) {
        throw httpError(409, `active ephemeral card limit exceeded: ${MAX_ACTIVE_EPHEMERAL_CARDS}`);
      }
      const summary = await this.read(user_id);
      if (summary.available_credits > MAX_USER_CREDITS - credits) {
        throw httpError(409, `user credits limit exceeded: ${MAX_USER_CREDITS}`);
      }
      throw httpError(409, "ephemeral card creation could not be applied");
    }
    return await this.read_ephemeral_from_transaction(transaction.transaction_id);
  }

  /** 给指定 Card 增加额度。 */
  async topup(input: CreditsTopupInput): Promise<CreditsTransaction> {
    const credits = read_credits(input.credits);
    const card_reference = this.normalize_card_reference(input.card);
    const request_payload = { card: card_reference, credits };
    const request_json = this.create_request_json(request_payload, input);
    const existing = await this.read_idempotent_transaction_by_key("topup", input.idempotency_key, request_json);
    if (existing) return existing;
    const card = await this.resolve_card(card_reference);
    await this.cleanup_expired_cards(card.user_id);
    const request = this.create_transaction_request("topup", {
      user_id: card.user_id,
      credits,
      idempotency_key: input.idempotency_key,
      source: input.source,
      ref: input.ref,
      note: input.note,
      metadata: input.metadata,
      request: request_payload,
    });
    const transaction_id = await this.create_transaction_id(request.kind, request.idempotency_key);
    const now = new Date().toISOString();
    await raw_atomic(this.resolve_raw(), [
      this.insert_transaction_command(transaction_id, request, now),
      this.update_card_command(transaction_id, card.kind, card.card_id, card.user_id, credits, "topup", now),
      this.insert_entry_from_card_command(transaction_id, 0, card.kind, card.card_id, credits, now),
      this.apply_transaction_command(transaction_id, credits, 1, now),
      this.rollback_card_command(transaction_id, card.kind, card.card_id, credits, "topup", now),
      ...this.cleanup_pending_transaction_commands(transaction_id),
      this.clear_marker_command(card.kind, card.card_id, transaction_id),
    ]);
    const transaction = await this.read_idempotent_transaction(request);
    if (!transaction) {
      if (card.kind === "ephemeral" && card.credits <= 0) {
        const active_count = await this.count_active_ephemeral_cards(card.user_id);
        if (active_count >= MAX_ACTIVE_EPHEMERAL_CARDS) {
          throw httpError(409, `active ephemeral card limit exceeded: ${MAX_ACTIVE_EPHEMERAL_CARDS}`);
        }
      }
      const summary = await this.read(card.user_id);
      if (summary.available_credits > MAX_USER_CREDITS - credits) {
        throw httpError(409, `user credits limit exceeded: ${MAX_USER_CREDITS}`);
      }
      throw httpError(409, "target card is expired or changed concurrently");
    }
    return transaction;
  }

  /** 从用户的一张或多张 Card 消费额度。 */
  async charge(input: CreditsChargeInput): Promise<CreditsTransaction> {
    const user_id = read_required_text(input.user_id, "user_id");
    const credits = read_credits(input.credits);
    const card_reference = input.card ? this.normalize_card_reference(input.card) : undefined;
    const request = this.create_transaction_request("charge", {
      user_id,
      credits,
      idempotency_key: input.idempotency_key,
      source: input.source,
      ref: input.ref,
      note: input.note,
      metadata: input.metadata,
      request: { user_id, credits, card: card_reference ?? null },
    });
    const existing = await this.read_idempotent_transaction(request);
    if (existing) return existing;
    const allocations = card_reference
      ? await this.allocate_selected_card(user_id, card_reference, credits)
      : await this.allocate_cards(user_id, credits);
    const transaction_id = await this.create_transaction_id(request.kind, request.idempotency_key);
    const now = new Date().toISOString();
    const commands: CreditsRawCommand[] = [this.insert_transaction_command(transaction_id, request, now)];
    const ephemeral_allocations = allocations.filter((allocation) => allocation.card_kind === "ephemeral");
    const primary_allocation = allocations.find((allocation) => allocation.card_kind === "primary");
    if (ephemeral_allocations.length > 0) {
      commands.push(
        this.update_ephemeral_allocations_command(transaction_id, ephemeral_allocations, now),
        this.insert_ephemeral_allocation_entries_command(transaction_id, ephemeral_allocations, now),
      );
    }
    if (primary_allocation) {
      commands.push(
        this.update_card_command(
          transaction_id,
          "primary",
          primary_allocation.card_id,
          primary_allocation.user_id,
          primary_allocation.credits,
          "charge",
          now,
        ),
        this.insert_entry_from_card_command(
          transaction_id,
          ephemeral_allocations.length,
          "primary",
          primary_allocation.card_id,
          -primary_allocation.credits,
          now,
        ),
      );
    }
    commands.push(this.apply_transaction_command(transaction_id, -credits, allocations.length, now));
    if (ephemeral_allocations.length > 0) {
      commands.push(this.rollback_ephemeral_allocations_command(transaction_id, ephemeral_allocations, now));
    }
    if (primary_allocation) {
      commands.push(this.rollback_card_command(
        transaction_id,
        "primary",
        primary_allocation.card_id,
        primary_allocation.credits,
        "charge",
        now,
      ));
    }
    commands.push(...this.cleanup_pending_transaction_commands(transaction_id));
    if (ephemeral_allocations.length > 0) commands.push(this.clear_markers_command("ephemeral", transaction_id));
    if (primary_allocation) commands.push(this.clear_marker_command("primary", primary_allocation.card_id, transaction_id));
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
    const normalized_card_id = read_required_text(card_id, "card_id");
    const now = new Date().toISOString();
    await raw_atomic(this.resolve_raw(), [{
      sql: `DELETE FROM ${EPHEMERAL_CARD_TABLE} WHERE card_id = ? AND expires_at <= ?`,
      params: [normalized_card_id, now],
    }]);
    const row = await raw_first<Record<string, unknown>>(this.resolve_raw(),
      `SELECT card_id, user_id, name, credits, expires_at, source, ref, created_at, updated_at FROM ${EPHEMERAL_CARD_TABLE} WHERE card_id = ?`,
      [normalized_card_id]);
    if (!row) throw httpError(404, "ephemeral card not found");
    return parse_ephemeral_card(row);
  }

  private async list_ephemeral_cards(query: CreditsEphemeralCardQuery): Promise<CreditsEphemeralCard[]> {
    const normalized_user_id = query.user_id ? read_required_text(query.user_id, "user_id") : undefined;
    await this.cleanup_expired_cards(normalized_user_id);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.user_id) {
      clauses.push("user_id = ?");
      params.push(normalized_user_id);
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
      this.list_ephemeral_cards({ user_id, include_history: false, limit: MAX_ACTIVE_EPHEMERAL_CARDS }),
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

  /** 规范化调用方提供的 Card 引用，避免等价参数产生不同幂等快照。 */
  private normalize_card_reference(reference: CreditsCardReference): CreditsCardReference {
    if (reference?.kind === "primary") {
      return { kind: "primary", user_id: read_required_text(reference.user_id, "card.user_id") };
    }
    if (reference?.kind === "ephemeral") {
      return { kind: "ephemeral", card_id: read_required_text(reference.card_id, "card.card_id") };
    }
    throw new TypeError("card.kind must be primary or ephemeral");
  }

  /** 构造包含全部业务参数的稳定幂等快照。 */
  private create_request_json(
    request: Record<string, unknown>,
    input: { source: string; ref?: string; note?: string; metadata?: Record<string, unknown> },
  ): string {
    return stable_stringify({
      ...request,
      source: read_required_text(input.source, "source"),
      ref: read_text(input.ref),
      note: read_text(input.note),
      metadata: input.metadata ?? {},
    });
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
    const source = read_required_text(input.source, "source");
    const ref = read_text(input.ref);
    const note = read_text(input.note);
    const metadata_json = stringify_json(input.metadata);
    return {
      kind,
      user_id: input.user_id,
      credits: input.credits,
      idempotency_key: read_required_text(input.idempotency_key, "idempotency_key"),
      request_json: stable_stringify({
        ...input.request,
        source,
        ref,
        note,
        metadata: input.metadata ?? {},
      }),
      source,
      ref,
      note,
      metadata_json,
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
    user_id: string,
    credits: number,
    operation: "topup" | "charge",
    now: string,
  ): CreditsRawCommand {
    const table = kind === "primary" ? PRIMARY_CARD_TABLE : EPHEMERAL_CARD_TABLE;
    const key = kind === "primary" ? "user_id" : "card_id";
    const delta = operation === "topup" ? credits : -credits;
    const sufficient = operation === "charge" ? "AND credits >= ?" : "";
    const unexpired = kind === "ephemeral" ? "AND expires_at > ?" : "";
    const within_card_limit = operation === "topup" && kind === "ephemeral"
      ? `AND (credits > 0 OR (SELECT COUNT(*) FROM ${EPHEMERAL_CARD_TABLE} WHERE user_id = ? AND expires_at > ? AND credits > 0) < ?)`
      : "";
    const within_user_limit = operation === "topup"
      ? [
          `AND COALESCE((SELECT credits FROM ${PRIMARY_CARD_TABLE} WHERE user_id = ?), 0)`,
          `+ COALESCE((SELECT SUM(credits) FROM ${EPHEMERAL_CARD_TABLE} WHERE user_id = ? AND expires_at > ?), 0) <= ?`,
        ].join(" ")
      : "";
    const params: unknown[] = [delta, transaction_id, now, card_id];
    if (operation === "charge") params.push(credits);
    if (kind === "ephemeral") params.push(now);
    if (operation === "topup" && kind === "ephemeral") {
      params.push(user_id, now, MAX_ACTIVE_EPHEMERAL_CARDS);
    }
    if (operation === "topup") params.push(user_id, user_id, now, MAX_USER_CREDITS - credits);
    params.push(transaction_id);
    return {
      sql: [
        `UPDATE ${table} SET credits = credits + ?, transaction_marker = ?, updated_at = ?`,
        `WHERE ${key} = ? ${sufficient} ${unexpired} ${within_card_limit} ${within_user_limit}`,
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

  /** 使用一条 SQL 原子扣除本次涉及的全部 Ephemeral Cards。 */
  private update_ephemeral_allocations_command(
    transaction_id: string,
    allocations: CardAllocation[],
    now: string,
  ): CreditsRawCommand {
    const allocations_json = this.serialize_ephemeral_allocations(allocations);
    return {
      sql: [
        "WITH allocations AS (",
        "SELECT json_extract(value, '$.card_id') AS card_id,",
        "CAST(json_extract(value, '$.credits') AS INTEGER) AS credits FROM json_each(?)",
        ")",
        `UPDATE ${EPHEMERAL_CARD_TABLE} SET`,
        `credits = credits - (SELECT credits FROM allocations WHERE allocations.card_id = ${EPHEMERAL_CARD_TABLE}.card_id),`,
        "transaction_marker = ?, updated_at = ?",
        "WHERE card_id IN (SELECT card_id FROM allocations)",
        "AND expires_at > ?",
        `AND credits >= (SELECT credits FROM allocations WHERE allocations.card_id = ${EPHEMERAL_CARD_TABLE}.card_id)`,
        `AND EXISTS (SELECT 1 FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'pending')`,
      ].join(" "),
      params: [allocations_json, transaction_id, now, now, transaction_id],
    };
  }

  /** 使用一条 INSERT SELECT 为全部 Ephemeral Card 扣费创建不可变 Entries。 */
  private insert_ephemeral_allocation_entries_command(
    transaction_id: string,
    allocations: CardAllocation[],
    now: string,
  ): CreditsRawCommand {
    const allocations_json = this.serialize_ephemeral_allocations(allocations);
    return {
      sql: [
        "WITH allocations AS (",
        "SELECT json_extract(value, '$.card_id') AS card_id,",
        "CAST(json_extract(value, '$.credits') AS INTEGER) AS credits,",
        "CAST(json_extract(value, '$.entry_index') AS INTEGER) AS entry_index FROM json_each(?)",
        ")",
        `INSERT INTO ${TRANSACTION_ENTRY_TABLE}`,
        "(entry_id, transaction_id, user_id, card_kind, card_id, credits_delta, credits_after, created_at)",
        "SELECT ? || allocations.entry_index, ?, cards.user_id, 'ephemeral', cards.card_id,",
        "-allocations.credits, cards.credits, ?",
        `FROM ${EPHEMERAL_CARD_TABLE} AS cards JOIN allocations ON allocations.card_id = cards.card_id`,
        "WHERE cards.transaction_marker = ?",
        `AND EXISTS (SELECT 1 FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'pending')`,
      ].join(" "),
      params: [allocations_json, `cte_${transaction_id}_`, transaction_id, now, transaction_id, transaction_id],
    };
  }

  /** Transaction 未能完整应用时，一次性恢复全部已修改的 Ephemeral Cards。 */
  private rollback_ephemeral_allocations_command(
    transaction_id: string,
    allocations: CardAllocation[],
    now: string,
  ): CreditsRawCommand {
    const allocations_json = this.serialize_ephemeral_allocations(allocations);
    return {
      sql: [
        "WITH allocations AS (",
        "SELECT json_extract(value, '$.card_id') AS card_id,",
        "CAST(json_extract(value, '$.credits') AS INTEGER) AS credits FROM json_each(?)",
        ")",
        `UPDATE ${EPHEMERAL_CARD_TABLE} SET`,
        `credits = credits + (SELECT credits FROM allocations WHERE allocations.card_id = ${EPHEMERAL_CARD_TABLE}.card_id),`,
        "updated_at = ?",
        "WHERE card_id IN (SELECT card_id FROM allocations) AND transaction_marker = ?",
        `AND EXISTS (SELECT 1 FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'pending')`,
      ].join(" "),
      params: [allocations_json, now, transaction_id, transaction_id],
    };
  }

  /** 将 Ephemeral Card 分配转换为单个 JSON SQL 参数，避免 D1 变量数量膨胀。 */
  private serialize_ephemeral_allocations(allocations: CardAllocation[]): string {
    return stable_stringify(allocations.map((allocation, entry_index) => ({
      card_id: allocation.card_id,
      credits: allocation.credits,
      entry_index,
    })));
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

  /** 清理一种 Card 上属于指定 Transaction 的全部内部标记。 */
  private clear_markers_command(kind: "primary" | "ephemeral", transaction_id: string): CreditsRawCommand {
    const table = kind === "primary" ? PRIMARY_CARD_TABLE : EPHEMERAL_CARD_TABLE;
    return {
      sql: `UPDATE ${table} SET transaction_marker = '' WHERE transaction_marker = ?`,
      params: [transaction_id],
    };
  }

  /** 删除指定用户或全局已经过期的 Ephemeral Cards。 */
  private async cleanup_expired_cards(user_id?: string): Promise<void> {
    const now = new Date().toISOString();
    await raw_atomic(this.resolve_raw(), [this.delete_expired_cards_command(user_id, now)]);
  }

  /** 构造过期 Card 清理命令，供业务事务复用。 */
  private delete_expired_cards_command(user_id: string | undefined, now: string): CreditsRawCommand {
    return user_id
      ? {
          sql: `DELETE FROM ${EPHEMERAL_CARD_TABLE} WHERE user_id = ? AND expires_at <= ?`,
          params: [user_id, now],
        }
      : {
          sql: `DELETE FROM ${EPHEMERAL_CARD_TABLE} WHERE expires_at <= ?`,
          params: [now],
        };
  }

  /** 统计一个用户当前有效且仍有余额的 Ephemeral Cards。 */
  private async count_active_ephemeral_cards(user_id: string): Promise<number> {
    const row = await raw_first<Record<string, unknown>>(this.resolve_raw(), [
      `SELECT COUNT(*) AS active_count FROM ${EPHEMERAL_CARD_TABLE}`,
      "WHERE user_id = ? AND expires_at > ? AND credits > 0",
    ].join(" "), [user_id, new Date().toISOString()]);
    return Number(row?.active_count ?? 0);
  }

  /** 把旧数据中的可解析时间统一迁移为 UTC ISO，无法解析的 Card 直接清理。 */
  private async normalize_existing_ephemeral_expirations(): Promise<void> {
    const rows = await raw_all<Record<string, unknown>>(this.resolve_raw(),
      `SELECT card_id, expires_at FROM ${EPHEMERAL_CARD_TABLE}`,
      []);
    const invalid_card = rows.find((row) => !Number.isFinite(Date.parse(String(row.expires_at ?? ""))));
    if (invalid_card) {
      throw new Error(`ephemeral card ${String(invalid_card.card_id)} has an invalid expires_at`);
    }
    const commands = rows.map((row): CreditsRawCommand => {
      const card_id = String(row.card_id ?? "");
      const timestamp = Date.parse(String(row.expires_at ?? ""));
      return {
        sql: `UPDATE ${EPHEMERAL_CARD_TABLE} SET expires_at = ? WHERE card_id = ?`,
        params: [new Date(timestamp).toISOString(), card_id],
      };
    });
    for (let index = 0; index < commands.length; index += 50) {
      await raw_atomic(this.resolve_raw(), commands.slice(index, index + 50));
    }
  }

  /** 启动时拒绝继续运行已经破坏 Card 数量或安全整数不变量的数据。 */
  private async assert_existing_data_limits(): Promise<void> {
    const now = new Date().toISOString();
    const excessive_cards = await raw_first<Record<string, unknown>>(this.resolve_raw(), [
      `SELECT user_id, COUNT(*) AS active_count FROM ${EPHEMERAL_CARD_TABLE}`,
      "WHERE expires_at > ? AND credits > 0 GROUP BY user_id HAVING COUNT(*) > ? LIMIT 1",
    ].join(" "), [now, MAX_ACTIVE_EPHEMERAL_CARDS]);
    if (excessive_cards) {
      throw new Error(`user ${String(excessive_cards.user_id)} exceeds ${MAX_ACTIVE_EPHEMERAL_CARDS} active ephemeral cards`);
    }
    const excessive_credits = await raw_first<Record<string, unknown>>(this.resolve_raw(), [
      "SELECT users.user_id,",
      `COALESCE(primary_card.credits, 0) + COALESCE(SUM(CASE WHEN ephemeral.expires_at > ? THEN ephemeral.credits ELSE 0 END), 0) AS total_credits`,
      `FROM (SELECT user_id FROM ${PRIMARY_CARD_TABLE} UNION SELECT user_id FROM ${EPHEMERAL_CARD_TABLE}) AS users`,
      `LEFT JOIN ${PRIMARY_CARD_TABLE} AS primary_card ON primary_card.user_id = users.user_id`,
      `LEFT JOIN ${EPHEMERAL_CARD_TABLE} AS ephemeral ON ephemeral.user_id = users.user_id`,
      "GROUP BY users.user_id HAVING total_credits > ? LIMIT 1",
    ].join(" "), [now, MAX_USER_CREDITS]);
    if (excessive_credits) {
      throw new Error(`user ${String(excessive_credits.user_id)} exceeds the safe Credits limit`);
    }
  }

  private resolve_raw(): unknown {
    if (!this._raw) throw new Error("credits service raw database is not ready");
    return this._raw;
  }
}
