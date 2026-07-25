/**
 * City 宿主注入 Chat Plugin 的账号存储 Adapter。
 *
 * 关键点（中文）
 * - 全局路径、SQLite 连接和密钥仍完全属于 CLI/City。
 * - 每次操作复用现有 PlatformStore，并在操作结束后立即关闭连接。
 * - Chat Plugin 只看见 ChatChannelAccountStore 契约，不依赖 CLI 实现。
 */

import type {
  ChatChannelAccountStore,
  StoredChannelAccount,
  UpsertChannelAccountInput,
} from "@downcity/plugins/chat";
import { createCityPlatformStore } from "@/city/runtime/store/index.js";

/** City 平台数据库上的 Chat Account 存储 Adapter。 */
export class CityChatAccountStore implements ChatChannelAccountStore {
  /** 同步列出 City 共享 Chat Account。 */
  list(channel_input?: string): StoredChannelAccount[] {
    const store = createCityPlatformStore();
    try {
      return store.listChannelAccountsSync(channel_input);
    } finally {
      store.close();
    }
  }

  /** 同步读取指定 City 共享 Chat Account。 */
  get(account_id_input: string): StoredChannelAccount | null {
    const store = createCityPlatformStore();
    try {
      return store.getChannelAccountSync(account_id_input);
    } finally {
      store.close();
    }
  }

  /** 新增或更新 City 共享 Chat Account。 */
  async upsert(input: UpsertChannelAccountInput): Promise<void> {
    const store = createCityPlatformStore();
    try {
      await store.upsertChannelAccount(input);
    } finally {
      store.close();
    }
  }

  /** 删除指定 City 共享 Chat Account。 */
  async remove(account_id_input: string): Promise<void> {
    const store = createCityPlatformStore();
    try {
      store.removeChannelAccount(account_id_input);
    } finally {
      store.close();
    }
  }
}
