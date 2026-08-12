/**
 * Credits Service 管理端调用器。
 *
 * Bureau 通过本调用器访问 `/v1/credits/*`，子资源按 cards、transactions 和
 * history 分组，保持公开 API 的领域归属清晰。
 */

import type { RequestInitLike } from "../../http.js";
import type {
  CreditsAccount,
  CreditsChargeInput,
  CreditsEphemeralCard,
  CreditsEphemeralCardCreateInput,
  CreditsEphemeralCardQuery,
  CreditsHistoryQuery,
  CreditsPrimaryCard,
  CreditsUserSummary,
  CreditsTopupInput,
  CreditsTransaction,
  CreditsTransactionEntry,
  CreditsTransactionQuery,
  CreditsUserQuery,
} from "./types.js";

const PREFIX = "/v1/credits";
type RequestJson = <T>(path: string, init: RequestInitLike) => Promise<T>;

/** Credits 管理端调用器。 */
export class CreditsInvoker {
  /** Card 管理入口。 */
  readonly cards: CreditsCardsInvoker;
  /** Transaction 查询入口。 */
  readonly transactions: CreditsTransactionsInvoker;
  /** 不可变流水查询入口。 */
  readonly history: CreditsHistoryInvoker;

  constructor(private readonly request_json: RequestJson) {
    this.cards = new CreditsCardsInvoker(request_json);
    this.transactions = new CreditsTransactionsInvoker(request_json);
    this.history = new CreditsHistoryInvoker(request_json);
  }

  /** 读取一个用户的当前 Credits 账户与 Card。 */
  get_user(user_id: string): Promise<CreditsAccount> {
    return this.request_json(with_query(`${PREFIX}/users/get`, { user_id }), { method: "GET" });
  }

  /** 查询 Credits 用户。 */
  async list_users(query: CreditsUserQuery = {}): Promise<CreditsUserSummary[]> {
    const body = await this.request_json<{ items: CreditsUserSummary[] }>(with_query(`${PREFIX}/users`, query), { method: "GET" });
    return body.items;
  }

  /** 给指定 Card 增加已确认额度。 */
  topup(input: CreditsTopupInput): Promise<CreditsTransaction> {
    return this.request_json(`${PREFIX}/topups/create`, { method: "POST", body: JSON.stringify(input) });
  }

  /** 从用户的一张或多张 Card 消费额度。 */
  charge(input: CreditsChargeInput): Promise<CreditsTransaction> {
    return this.request_json(`${PREFIX}/charges/create`, { method: "POST", body: JSON.stringify(input) });
  }
}

/** Credits Card 管理调用器。 */
export class CreditsCardsInvoker {
  constructor(private readonly request_json: RequestJson) {}

  /** 读取用户 Primary Card。 */
  get_primary(user_id: string): Promise<CreditsPrimaryCard> {
    return this.request_json(with_query(`${PREFIX}/cards/primary`, { user_id }), { method: "GET" });
  }

  /** 按 ID 读取 Ephemeral Card。 */
  get_ephemeral(card_id: string): Promise<CreditsEphemeralCard> {
    return this.request_json(with_query(`${PREFIX}/cards/ephemeral/get`, { card_id }), { method: "GET" });
  }

  /** 查询 Ephemeral Cards。 */
  async list_ephemeral(query: CreditsEphemeralCardQuery = {}): Promise<CreditsEphemeralCard[]> {
    const body = await this.request_json<{ items: CreditsEphemeralCard[] }>(
      with_query(`${PREFIX}/cards/ephemeral`, query),
      { method: "GET" },
    );
    return body.items;
  }

  /** 创建 Ephemeral Card 并写入初始额度。 */
  create_ephemeral(input: CreditsEphemeralCardCreateInput): Promise<CreditsEphemeralCard> {
    return this.request_json(`${PREFIX}/cards/ephemeral/create`, { method: "POST", body: JSON.stringify(input) });
  }
}

/** Credits Transaction 查询调用器。 */
export class CreditsTransactionsInvoker {
  constructor(private readonly request_json: RequestJson) {}

  /** 查询 Transactions。 */
  async list(query: CreditsTransactionQuery = {}): Promise<CreditsTransaction[]> {
    const body = await this.request_json<{ items: CreditsTransaction[] }>(with_query(`${PREFIX}/transactions`, query), { method: "GET" });
    return body.items;
  }

  /** 按 ID 读取 Transaction。 */
  get(transaction_id: string): Promise<CreditsTransaction> {
    return this.request_json(with_query(`${PREFIX}/transactions/get`, { transaction_id }), { method: "GET" });
  }
}

/** Credits Entry 流水查询调用器。 */
export class CreditsHistoryInvoker {
  constructor(private readonly request_json: RequestJson) {}

  /** 查询不可变 Transaction Entries。 */
  async list(query: CreditsHistoryQuery = {}): Promise<CreditsTransactionEntry[]> {
    const body = await this.request_json<{ items: CreditsTransactionEntry[] }>(with_query(`${PREFIX}/history`, query), { method: "GET" });
    return body.items;
  }
}

/** 构造忽略空值的查询 URL。 */
function with_query(url: string, query: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query_string = search.toString();
  return query_string ? `${url}?${query_string}` : url;
}
