/**
 * `city chat` 交互式管理器。
 *
 * 关键点（中文）
 * - 裸 `city chat` 进入 chat plugin 共享资源管理，而不是只输出静态 help。
 * - chat account 属于 City 级共享资源，供各 agent 的 chat plugin 选择绑定。
 * - 访问控制属于 chat plugin 的 access 能力，不再作为独立 plugin 心智暴露。
 * - City 不管理 chat plugin 运行态；运行态由具体 agent 内部托管。
 */

import prompts, { type PromptObject } from "@/city/tui/Prompts.js";
import {
  ChatChannelAccountManager,
  type ChatChannelAccountListItem,
  type StoredChannelAccountChannel,
} from "@downcity/plugins/chat";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { CityChatAccountStore } from "@/city/runtime/plugins/CityChatAccountStore.js";
import type {
  ChatAccountAction,
  ChatManagerListSelection,
} from "@/city/shared/ChatManagerTypes.js";
import { run_interactive_chat_access_manager } from "@/city/shared/ChatAccessManager.js";
import { t } from "@/shared/CliLocale.js";

const CHAT_CHANNELS: StoredChannelAccountChannel[] = ["telegram", "feishu", "qq"];

function createChannelAccountManager(): ChatChannelAccountManager {
  return new ChatChannelAccountManager(new CityChatAccountStore());
}

function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

function formatAccountTitle(account: ChatChannelAccountListItem): string {
  const identity = account.identity ? ` · ${account.identity}` : "";
  return `${account.channel} · ${account.name}${identity}`;
}

function formatCredentialSummary(account: ChatChannelAccountListItem): string {
  const parts: string[] = [];
  if (account.botTokenMasked) parts.push(`botToken ${account.botTokenMasked}`);
  if (account.appIdMasked) parts.push(`appId ${account.appIdMasked}`);
  if (account.appSecretMasked) parts.push(`appSecret ${account.appSecretMasked}`);
  if (account.domain) parts.push(`domain ${account.domain}`);
  if (account.sandbox) parts.push("sandbox");
  return parts.join(" · ") || "no credentials";
}

function formatAccountDetail(account: ChatChannelAccountListItem): string {
  return t({
    zh: [
      `账号 ID：${account.id}`,
      `渠道：${account.channel}`,
      `名称：${account.name}`,
      account.identity ? `身份：${account.identity}` : "",
      `凭据：${formatCredentialSummary(account)}`,
      `更新时间：${account.updated_at}`,
      "",
      "Enter 进入该 Chat 账号的管理面板，在里面编辑或删除账号。",
    ].filter(Boolean).join("\n"),
    en: [
      `Account ID: ${account.id}`,
      `Channel: ${account.channel}`,
      `Name: ${account.name}`,
      account.identity ? `Identity: ${account.identity}` : "",
      `Credentials: ${formatCredentialSummary(account)}`,
      `Updated: ${account.updated_at}`,
      "",
      "Press Enter to open this chat account's management panel, then edit or remove it there.",
    ].filter(Boolean).join("\n"),
  });
}

async function promptChatListSelection(): Promise<ChatManagerListSelection | null> {
  const manager = createChannelAccountManager();
  const accounts = await manager.list();
  const response = (await prompts({
    type: "select",
    name: "selection",
    message: t({
      zh: "Chat 共享资源",
      en: "Manage chat plugin shared resources",
    }),
    choices: [
      {
        title: t({
          zh: "Chat 账号",
          en: "Chat accounts",
        }),
        disabled: true,
      },
      ...accounts.items.map((account) => ({
        title: formatAccountTitle(account),
        description: formatAccountDetail(account),
        value: {
          type: "account" as const,
          account_id: account.id,
        },
      })),
      {
        title: t({
          zh: "操作",
          en: "Actions",
        }),
        disabled: true,
      },
      {
        title: t({
          zh: "新增 Chat 账号",
          en: "Add chat account",
        }),
        description: t({
          zh: accounts.items.length === 0
            ? "当前还没有 Chat 账号。新增 Telegram、Feishu 或 QQ 账号，保存为 City 级共享资源。"
            : "新增 Telegram、Feishu 或 QQ 账号，保存为 City 级共享资源。",
          en: accounts.items.length === 0
            ? "No chat accounts are configured yet. Add a Telegram, Feishu, or QQ account as a City-level shared resource."
            : "Add a Telegram, Feishu, or QQ account as a City-level shared resource.",
        }),
        value: {
          type: "add" as const,
        },
      },
      {
        title: t({
          zh: "访问控制",
          en: "Access control",
        }),
        description: t({
          zh: "先选择 Agent，再处理 Chat 用户的准入请求。",
          en: "Select an Agent, then manage Chat user access requests.",
        }),
        value: {
          type: "access" as const,
        },
      },
      {
        title: t({
          zh: "退出",
          en: "Exit",
        }),
        description: t({
          zh: "关闭 chat manager",
          en: "Close the chat manager",
        }),
        value: {
          type: "exit" as const,
        },
      },
    ],
    initial: accounts.items.length > 0 ? 1 : 2,
  })) as { selection?: ChatManagerListSelection };

  return response.selection || null;
}

async function promptChatAccountAction(
  account: ChatChannelAccountListItem,
): Promise<ChatAccountAction | null> {
  const response = (await prompts({
    type: "select",
    name: "action",
    message: t({
      zh: `管理 Chat 账号 · ${account.name}`,
      en: `Manage chat account · ${account.name}`,
    }),
    choices: [
      {
        title: t({
          zh: "账号",
          en: "Account",
        }),
        disabled: true,
      },
      {
        title: t({
          zh: "编辑 Chat 账号",
          en: "Edit account",
        }),
        description: t({
          zh: `${formatCredentialSummary(account)}。修改账号名称、域名或密钥；留空的密钥字段会保持不变。`,
          en: `${formatCredentialSummary(account)}. Edit name, domain, or credentials; empty credential fields keep the current value.`,
        }),
        value: "edit",
      },
      {
        title: t({
          zh: "删除 Chat 账号",
          en: "Remove account",
        }),
        description: t({
          zh: "从 City 全局账号池删除该账号；已绑定的 Agent 后续会提示清理悬空引用。",
          en: "Remove an account from the City global pool",
        }),
        value: "remove",
      },
      {
        title: t({
          zh: "导航",
          en: "Navigation",
        }),
        disabled: true,
      },
      {
        title: t({
          zh: "返回",
          en: "Back",
        }),
        description: t({
          zh: "回到 Chat 账号列表。",
          en: "Return to the chat account list.",
        }),
        value: "back",
      },
    ],
    initial: 0,
  })) as { action?: ChatAccountAction };

  return response.action || null;
}

async function reloadChatAccount(account_id: string): Promise<ChatChannelAccountListItem | null> {
  const manager = createChannelAccountManager();
  const { items } = await manager.list();
  return items.find((account) => account.id === account_id) || null;
}

async function chooseChannel(): Promise<StoredChannelAccountChannel | null> {
  const response = (await prompts({
    type: "select",
    name: "channel",
    message: t({
      zh: "选择 Chat 渠道",
      en: "Select chat channel",
    }),
    choices: CHAT_CHANNELS.map((channel) => ({
      title: channel,
      description: t({
        zh: `为新的 City 级 Chat 账号选择 ${channel} 渠道。`,
        en: `Choose ${channel} as the channel for the new City-level chat account.`,
      }),
      value: channel,
    })),
    initial: 0,
  })) as { channel?: StoredChannelAccountChannel };

  return response.channel || null;
}

async function promptCredentialFields(params: {
  channel: StoredChannelAccountChannel;
  current?: ChatChannelAccountListItem;
}): Promise<{
  name?: string;
  botToken?: string;
  appId?: string;
  appSecret?: string;
  domain?: string;
  sandbox?: boolean;
}> {
  const questions: PromptObject[] = [
    {
      type: "text",
      name: "name",
      message: t({
        zh: "账号名称",
        en: "Account name",
      }),
      initial: params.current?.name || "",
    },
  ];

  if (params.channel === "telegram") {
    questions.push({
      type: "password",
      name: "botToken",
      message: params.current
        ? t({
          zh: "Bot Token（留空保持不变）",
          en: "Bot token (leave empty to keep unchanged)",
        })
        : t({ zh: "Bot Token", en: "Bot token" }),
    });
  }

  if (params.channel === "feishu" || params.channel === "qq") {
    questions.push(
      {
        type: "text",
        name: "appId",
        message: params.current
          ? t({
            zh: "App ID（留空保持不变）",
            en: "App ID (leave empty to keep unchanged)",
          })
          : t({ zh: "App ID", en: "App ID" }),
      },
      {
        type: "password",
        name: "appSecret",
        message: params.current
          ? t({
            zh: "App Secret（留空保持不变）",
            en: "App secret (leave empty to keep unchanged)",
          })
          : t({ zh: "App Secret", en: "App secret" }),
      },
    );
  }

  if (params.channel === "feishu") {
    questions.push({
      type: "text",
      name: "domain",
      message: t({
        zh: "Domain（可选，例如 open.feishu.cn）",
        en: "Domain (optional, for example open.feishu.cn)",
      }),
      initial: params.current?.domain || "",
    });
  }

  if (params.channel === "qq") {
    questions.push({
      type: "confirm",
      name: "sandbox",
      message: t({
        zh: "启用 QQ sandbox？",
        en: "Enable QQ sandbox?",
      }),
      initial: params.current?.sandbox === true,
    });
  }

  const response = (await prompts(questions)) as {
    name?: string;
    botToken?: string;
    appId?: string;
    appSecret?: string;
    domain?: string;
    sandbox?: boolean;
  };

  return response;
}

async function addChannelAccount(): Promise<void> {
  const channel = await chooseChannel();
  if (!channel) return;

  const input = await promptCredentialFields({ channel });
  const name = String(input.name || "").trim();

  const probeResponse = (await prompts({
    type: "confirm",
    name: "probe",
    message: t({
      zh: "保存前探测 bot 信息？",
      en: "Probe bot info before saving?",
    }),
    initial: true,
  })) as { probe?: boolean };

  const manager = createChannelAccountManager();
  const result = await manager.create({
    channel,
    name,
    botToken: input.botToken,
    appId: input.appId,
    appSecret: input.appSecret,
    domain: input.domain,
    sandbox: input.sandbox,
    probe: probeResponse.probe !== false,
  });

  emitCliBlock({
    tone: "success",
    title: "Chat account saved",
    summary: result.id,
    note: result.message || (result.probed ? "bot 信息已探测" : "已按输入信息保存"),
  });
}

async function editChannelAccount(account: ChatChannelAccountListItem): Promise<ChatChannelAccountListItem> {
  const input = await promptCredentialFields({
    channel: account.channel,
    current: account,
  });
  const manager = createChannelAccountManager();
  await manager.upsert({
    id: account.id,
    channel: account.channel,
    name: String(input.name || account.name).trim(),
    botToken: String(input.botToken || "").trim() || undefined,
    appId: String(input.appId || "").trim() || undefined,
    appSecret: String(input.appSecret || "").trim() || undefined,
    domain: input.domain,
    sandbox: input.sandbox,
  });

  emitCliBlock({
    tone: "success",
    title: "Chat account updated",
    summary: account.id,
  });
  return await reloadChatAccount(account.id) || account;
}

async function removeChannelAccount(account: ChatChannelAccountListItem): Promise<boolean> {
  const response = (await prompts({
    type: "confirm",
    name: "remove",
    message: t({
      zh: `删除 ${account.channel} · ${account.name}？`,
      en: `Remove ${account.channel} · ${account.name}?`,
    }),
    initial: false,
  })) as { remove?: boolean };

  if (response.remove !== true) return false;

  const manager = createChannelAccountManager();
  await manager.remove(account.id);
  emitCliBlock({
    tone: "success",
    title: "Chat account removed",
    summary: account.id,
  });
  return true;
}

async function runChatAccountManager(account_input: ChatChannelAccountListItem): Promise<void> {
  let account = account_input;
  while (true) {
    const latest_account = await reloadChatAccount(account.id);
    if (!latest_account) {
      emitCliBlock({
        tone: "info",
        title: "Chat account no longer exists",
        summary: account.id,
      });
      return;
    }
    account = latest_account;
    const action = await promptChatAccountAction(account);
    if (!action || action === "back") return;

    try {
      if (action === "edit") {
        account = await editChannelAccount(account);
        continue;
      }
      if (action === "remove") {
        const removed = await removeChannelAccount(account);
        if (removed) return;
      }
    } catch (error) {
      emitCliBlock({
        tone: "error",
        title: "Chat account action failed",
        note: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * 运行 `city chat` 交互式管理器。
 */
export async function runInteractiveChatManager(): Promise<void> {
  if (!isInteractiveTerminal()) return;

  while (true) {
    const selection = await promptChatListSelection();
    if (!selection || selection.type === "exit") {
      emitCliBlock({
        tone: "info",
        title: "Chat manager closed",
      });
      return;
    }

    try {
      if (selection.type === "add") {
        await addChannelAccount();
        continue;
      }
      if (selection.type === "access") {
        await run_interactive_chat_access_manager();
        continue;
      }
      if (selection.type === "account") {
        const account = await reloadChatAccount(selection.account_id);
        if (!account) {
          emitCliBlock({
            tone: "info",
            title: "Chat account not found",
            summary: selection.account_id,
          });
          continue;
        }
        await runChatAccountManager(account);
      }
    } catch (error) {
      emitCliBlock({
        tone: "error",
        title: "Chat manager action failed",
        note: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
