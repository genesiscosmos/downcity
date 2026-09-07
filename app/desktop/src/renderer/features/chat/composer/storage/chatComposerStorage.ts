/**
 * Desktop Chat 输入编排的 IndexedDB 持久化实现。
 *
 * composer store 始终是运行时唯一事实源；本模块只提供可丢失、可重建的跨重启副本。
 * 所有操作共用串行队列，确保快速输入、发送清理和上下文迁移不会乱序落库。
 */

import type { JSONContent } from "@tiptap/core";
import type { QueuedChatMessage } from "@/types/DesktopView";
import type {
  ChatComposerPersistenceSnapshot,
  ChatComposerStorage,
  PersistedChatDraft,
  PersistedChatQueue,
} from "@/types/ChatComposerStorage";

/** 当前持久化记录结构版本。 */
export const chat_composer_schema_version = 1;

const database_name = "downcity-desktop";
const database_version = 2;
const draft_store_name = "chat_drafts";
const queue_store_name = "chat_queues";

let database_promise: Promise<IDBDatabase> | undefined;
let operation_queue: Promise<void> = Promise.resolve();

/** 判断未知值是否为可读取字段的普通对象。 */
function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 判断记录键是否属于当前支持的 Agent 或 Group Chat 命名空间。 */
function is_chat_key(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("session|") || value.startsWith("group|"));
}

/** 判断未知值是否为需要持久化的非空 Tiptap 文档。 */
function is_persistable_document(value: unknown): value is JSONContent {
  if (!is_record(value) || value.type !== "doc") return false;
  const pending_nodes: unknown[] = [value];
  const visited_nodes = new Set<object>();
  while (pending_nodes.length > 0) {
    const current = pending_nodes.pop();
    if (!is_record(current) || visited_nodes.has(current)) continue;
    visited_nodes.add(current);
    if (current.type === "text" && typeof current.text === "string" && current.text.trim()) return true;
    if (current.type === "chatAttachment" && is_record(current.attrs)
      && typeof current.attrs.data_url === "string" && current.attrs.data_url.trim()) return true;
    if (current.type === "chatReference" && is_record(current.attrs)
      && typeof current.attrs.text === "string" && current.attrs.text.trim()) return true;
    if (current.type === "chatData" && is_record(current.attrs)
      && typeof current.attrs.data_type === "string" && current.attrs.data_type.trim()) return true;
    if (Array.isArray(current.content)) pending_nodes.push(...current.content);
  }
  return false;
}

/** 校验并收窄一条 IndexedDB 草稿记录。 */
export function parse_persisted_chat_draft(value: unknown): PersistedChatDraft | undefined {
  if (!is_record(value)
    || value.schema_version !== chat_composer_schema_version
    || !is_chat_key(value.session_key)
    || typeof value.updated_at !== "number"
    || !Number.isFinite(value.updated_at)
    || value.updated_at < 0
    || !is_persistable_document(value.draft)) return undefined;
  return value as unknown as PersistedChatDraft;
}

/** 校验一条待发送消息，并把崩溃前的发送中状态恢复为可操作状态。 */
function parse_queued_message(value: unknown): QueuedChatMessage | undefined {
  if (!is_record(value)
    || typeof value.message_id !== "string"
    || !value.message_id.trim()
    || !is_persistable_document(value.input)
    || typeof value.created_at !== "number"
    || !Number.isFinite(value.created_at)
    || value.created_at < 0
    || typeof value.sending !== "boolean"
    || typeof value.paused !== "boolean") return undefined;
  return {
    message_id: value.message_id,
    input: value.input,
    created_at: value.created_at,
    sending: false,
    paused: value.paused,
  };
}

/** 校验并收窄一条 IndexedDB 待发送队列记录。 */
export function parse_persisted_chat_queue(value: unknown): PersistedChatQueue | undefined {
  if (!is_record(value)
    || value.schema_version !== chat_composer_schema_version
    || typeof value.session_key !== "string"
    || !value.session_key.startsWith("session|")
    || typeof value.updated_at !== "number"
    || !Number.isFinite(value.updated_at)
    || value.updated_at < 0
    || !Array.isArray(value.queued_messages)) return undefined;
  const queued_messages = value.queued_messages.map(parse_queued_message).filter((item): item is QueuedChatMessage => Boolean(item));
  if (queued_messages.length === 0) return undefined;
  return {
    schema_version: chat_composer_schema_version,
    session_key: value.session_key,
    queued_messages,
    updated_at: value.updated_at,
  };
}

/** 将未知数据库记录投影为 composer store 可恢复的草稿映射。 */
export function project_persisted_chat_drafts(records: readonly unknown[]): Record<string, JSONContent> {
  const drafts: Record<string, JSONContent> = {};
  for (const record of records) {
    const parsed = parse_persisted_chat_draft(record);
    if (parsed) drafts[parsed.session_key] = parsed.draft;
  }
  return drafts;
}

/** 将未知数据库记录投影为 composer store 可恢复的待发送队列映射。 */
export function project_persisted_chat_queues(records: readonly unknown[]): Record<string, QueuedChatMessage[]> {
  const queues: Record<string, QueuedChatMessage[]> = {};
  for (const record of records) {
    const parsed = parse_persisted_chat_queue(record);
    if (parsed) queues[parsed.session_key] = parsed.queued_messages;
  }
  return queues;
}

/** 为恢复出的全部非空队列建立会话级暂停状态，等待用户显式恢复。 */
export function create_recovered_queue_pause_state(
  queued_messages_by_session: Record<string, QueuedChatMessage[]>,
): Record<string, boolean> {
  return Object.fromEntries(Object.keys(queued_messages_by_session).map((session_key) => [session_key, true]));
}

/** 打开并缓存 Chat 输入编排数据库连接。 */
function open_database(): Promise<IDBDatabase> {
  if (database_promise) return database_promise;
  database_promise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前 Renderer 不支持 IndexedDB"));
      return;
    }
    const request = indexedDB.open(database_name, database_version);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(draft_store_name)) {
        database.createObjectStore(draft_store_name, { keyPath: "session_key" });
      }
      if (!database.objectStoreNames.contains(queue_store_name)) {
        database.createObjectStore(queue_store_name, { keyPath: "session_key" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        database_promise = undefined;
      };
      resolve(database);
    };
    request.onerror = () => {
      database_promise = undefined;
      reject(request.error ?? new Error("无法打开 Chat 输入编排数据库"));
    };
  });
  return database_promise;
}

/** 等待 IndexedDB 请求返回结果。 */
function wait_for_request<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Chat 输入编排数据库请求失败"));
  });
}

/** 等待 IndexedDB 事务完整提交。 */
function wait_for_transaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Chat 输入编排数据库事务已中止"));
    transaction.onerror = () => reject(transaction.error ?? new Error("Chat 输入编排数据库事务失败"));
  });
}

/** 把持久化操作加入串行队列，同时允许失败后的后续操作继续执行。 */
function enqueue_operation<Result>(operation: () => Promise<Result>): Promise<Result> {
  const result = operation_queue.then(operation);
  operation_queue = result.then(() => undefined, () => undefined);
  return result;
}

/** 在一个事务内执行草稿组合键迁移。 */
function move_draft_record(database: IDBDatabase, source_key: string, target_key: string): Promise<void> {
  if (source_key === target_key) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(draft_store_name, "readwrite");
    const store = transaction.objectStore(draft_store_name);
    const request = store.get(source_key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Chat 草稿迁移事务已中止"));
    transaction.onerror = () => reject(transaction.error ?? new Error("Chat 草稿迁移事务失败"));
    request.onsuccess = () => {
      const source_record = parse_persisted_chat_draft(request.result);
      store.delete(source_key);
      store.delete(target_key);
      if (source_record) store.put({ ...source_record, session_key: target_key, updated_at: Date.now() });
    };
  });
}

/** 创建浏览器原生 IndexedDB 输入编排持久化能力。 */
function create_chat_composer_storage(): ChatComposerStorage {
  return {
    load: () => enqueue_operation(async () => {
      const database = await open_database();
      const transaction = database.transaction([draft_store_name, queue_store_name], "readonly");
      const completion = wait_for_transaction(transaction);
      const [draft_records, queue_records] = await Promise.all([
        wait_for_request(transaction.objectStore(draft_store_name).getAll()),
        wait_for_request(transaction.objectStore(queue_store_name).getAll()),
        completion,
      ]);
      const queued_messages_by_session = project_persisted_chat_queues(queue_records);
      return {
        draft_content_by_session: project_persisted_chat_drafts(draft_records),
        queued_messages_by_session,
        queue_paused_by_session: create_recovered_queue_pause_state(queued_messages_by_session),
      } satisfies ChatComposerPersistenceSnapshot;
    }),
    save_draft: (session_key, draft) => enqueue_operation(async () => {
      const database = await open_database();
      const transaction = database.transaction(draft_store_name, "readwrite");
      const completion = wait_for_transaction(transaction);
      transaction.objectStore(draft_store_name).put({
        schema_version: chat_composer_schema_version,
        session_key,
        draft,
        updated_at: Date.now(),
      } satisfies PersistedChatDraft);
      await completion;
    }),
    remove_draft: (session_key) => enqueue_operation(async () => {
      const database = await open_database();
      const transaction = database.transaction(draft_store_name, "readwrite");
      const completion = wait_for_transaction(transaction);
      transaction.objectStore(draft_store_name).delete(session_key);
      await completion;
    }),
    move_draft: (source_key, target_key) => enqueue_operation(async () => {
      await move_draft_record(await open_database(), source_key, target_key);
    }),
    save_queue: (session_key, queued_messages) => enqueue_operation(async () => {
      const database = await open_database();
      const transaction = database.transaction(queue_store_name, "readwrite");
      const completion = wait_for_transaction(transaction);
      transaction.objectStore(queue_store_name).put({
        schema_version: chat_composer_schema_version,
        session_key,
        queued_messages,
        updated_at: Date.now(),
      } satisfies PersistedChatQueue);
      await completion;
    }),
    remove_queue: (session_key) => enqueue_operation(async () => {
      const database = await open_database();
      const transaction = database.transaction(queue_store_name, "readwrite");
      const completion = wait_for_transaction(transaction);
      transaction.objectStore(queue_store_name).delete(session_key);
      await completion;
    }),
    remove_prefixes: (prefixes) => enqueue_operation(async () => {
      if (prefixes.length === 0) return;
      const database = await open_database();
      const transaction = database.transaction([draft_store_name, queue_store_name], "readwrite");
      const completion = wait_for_transaction(transaction);
      for (const store_name of [draft_store_name, queue_store_name]) {
        const store = transaction.objectStore(store_name);
        const request = store.openKeyCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          const key = typeof cursor.key === "string" ? cursor.key : "";
          if (prefixes.some((prefix) => key.startsWith(prefix))) store.delete(cursor.primaryKey);
          cursor.continue();
        };
      }
      await completion;
    }),
  };
}

/** Renderer 进程共享的 Chat 输入编排持久化实例。 */
export const chat_composer_storage = create_chat_composer_storage();
