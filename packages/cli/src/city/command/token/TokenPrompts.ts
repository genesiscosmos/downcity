/**
 * Token 命令交互式提示流程。
 *
 * 关键点（中文）
 * - 封装所有需要 prompts 的交互式入口。
 * - 与动作、渲染模块解耦，只负责引导用户输入。
 */

import prompts from "@/city/tui/Prompts.js";
import type { AuthIssuedToken, AuthTokenSummary } from "@downcity/type";
import { AuthService } from "@/city/runtime/auth/AuthService.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import {
  copyTextToClipboard,
  formatTokenStateLabel,
  isInteractiveTerminal,
} from "./TokenHelpers.js";
import { emitTokenDetail, emitTokenSetupGuide } from "./TokenRender.js";
import { createToken, deleteToken } from "./TokenActions.js";

async function promptTokenCreateInput(params?: {
  defaultName?: string;
  defaultExpiresAt?: string;
}): Promise<{
  name: string;
  expires_at?: string;
} | null> {
  if (!isInteractiveTerminal()) {
    emitCliBlock({
      tone: "error",
      title: "Token name is required",
      note: "Use `city token create <name>` or run this command in an interactive terminal.",
    });
    return null;
  }

  const response = (await prompts([
    {
      type: "text",
      name: "name",
      message: "Token 名称",
      initial: String(params?.defaultName || "").trim() || "city-client",
      validate: (value: string) => {
        return String(value || "").trim() ? true : "请输入 token 名称";
      },
    },
    {
      type: "text",
      name: "expires_at",
      message: "过期时间（可选，ISO 字符串）",
      initial: String(params?.defaultExpiresAt || "").trim(),
      validate: (value: string) => {
        const normalized = String(value || "").trim();
        if (!normalized) return true;
        return Number.isNaN(Date.parse(normalized))
          ? "请输入合法的 ISO 时间，例如 2026-04-30T00:00:00.000Z"
          : true;
      },
    },
  ])) as {
    name?: string;
    expires_at?: string;
  };

  const name = String(response.name || "").trim();
  if (!name) {
    emitCliBlock({
      tone: "info",
      title: "Token create cancelled",
    });
    return null;
  }

  const expires_at = String(response.expires_at || "").trim();
  return {
    name,
    expires_at: expires_at || undefined,
  };
}

export async function promptTokenIdForDelete(): Promise<string | null> {
  if (!isInteractiveTerminal()) {
    emitCliBlock({
      tone: "error",
      title: "Token ID is required",
      note: "Use `city token delete <token_id>` or run this command in an interactive terminal.",
    });
    return null;
  }

  const authService = new AuthService();
  try {
    const tokens = authService.listLocalCliTokens();
    if (tokens.length === 0) {
      emitCliBlock({
        tone: "info",
        title: "No tokens",
        note: "可先执行 `city token create`。",
      });
      return null;
    }

    const response = (await prompts({
      type: "select",
      name: "token_id",
      message: "选择要删除的 token",
      choices: tokens.map((item) => ({
        title: item.name,
        description: item.id,
        value: item.id,
      })),
      initial: 0,
    })) as { token_id?: string };

    const token_id = String(response.token_id || "").trim();
    if (!token_id) {
      emitCliBlock({
        tone: "info",
        title: "Token delete cancelled",
      });
      return null;
    }
    return token_id;
  } finally {
    authService.close();
  }
}

function loadLocalCliTokens(): AuthTokenSummary[] {
  const authService = new AuthService();
  try {
    return authService.listLocalCliTokens();
  } finally {
    authService.close();
  }
}

async function runInteractivePostCreateActions(params: {
  issued: AuthIssuedToken;
}): Promise<void> {
  while (true) {
    const response = (await prompts({
      type: "select",
      name: "action",
      message: "创建完成，下一步要做什么？",
      choices: [
        {
          title: "复制 token",
          description: "把刚签发的明文 token 复制到系统剪贴板",
          value: "copy",
        },
        {
          title: "查看接入说明",
          description: "显示 token 的通用使用说明",
          value: "guide",
        },
        {
          title: "返回",
          description: "回到上一级菜单",
          value: "back",
        },
      ],
      initial: 0,
    })) as { action?: string };

    const action = String(response.action || "").trim();
    if (!action || action === "back") return;

    if (action === "copy") {
      const copied = copyTextToClipboard(params.issued.token);
      emitCliBlock({
        tone: copied.success ? "success" : "warning",
        title: copied.success ? "Token copied" : "Clipboard unavailable",
        facts: copied.success
          ? [
              {
                label: "Backend",
                value: String(copied.backend || "clipboard"),
              },
            ]
          : [],
        note: copied.success
          ? "当前剪贴板里已经是刚签发的 Bearer Token。"
          : "当前环境没有可用的剪贴板命令，请直接复制终端里显示的 token。",
      });
      continue;
    }

    if (action === "guide") {
      emitTokenSetupGuide(params.issued);
      continue;
    }
  }
}

async function runInteractiveCreateFlow(): Promise<void> {
  const input = await promptTokenCreateInput({
    defaultName: "token",
  });
  if (!input) return;

  const issued = createToken(input);
  await runInteractivePostCreateActions({
    issued,
  });
}

export async function runInteractiveCreateCommandFlow(options: {
  expires_at?: string;
}): Promise<void> {
  const input = await promptTokenCreateInput({
    defaultName: "token",
    defaultExpiresAt: options.expires_at,
  });
  if (!input) return;

  const issued = createToken(input);
  await runInteractivePostCreateActions({
    issued,
  });
}

async function runInteractiveTokenBrowser(): Promise<void> {
  while (true) {
    const tokens = loadLocalCliTokens();
    if (tokens.length === 0) {
      emitCliBlock({
        tone: "info",
        title: "Tokens",
        summary: "0 configured",
        note: "当前还没有本机 token，可先执行创建流程。",
      });
      return;
    }

    const response = (await prompts({
      type: "select",
      name: "token_id",
      message: "选择一个 token 查看详情",
      choices: [
        ...tokens.map((item) => ({
          title: item.name,
          description: `${formatTokenStateLabel(item)} · ${item.id}`,
          value: item.id,
        })),
        {
          title: "返回",
          description: "回到上一级菜单",
          value: "__back__",
        },
      ],
      initial: 0,
    })) as { token_id?: string };

    const token_id = String(response.token_id || "").trim();
    if (!token_id || token_id === "__back__") return;

    while (true) {
      const current = loadLocalCliTokens().find((item) => item.id === token_id);
      if (!current) {
        emitCliBlock({
          tone: "warning",
          title: "Token not found",
          note: "该 token 可能已经被其他命令删除。",
        });
        break;
      }

      emitTokenDetail(current);

      const actionResponse = (await prompts({
        type: "select",
        name: "action",
        message: "选择后续操作",
        choices: [
          {
            title: "删除 token",
            description: "立即删除当前 token",
            value: "delete",
          },
          {
            title: "返回 token 列表",
            description: "继续浏览其他 token",
            value: "back",
          },
        ],
        initial: 0,
      })) as { action?: string };

      const action = String(actionResponse.action || "").trim();
      if (!action || action === "back") break;
      if (action === "delete") {
        deleteToken(current.id, false);
      }
    }
  }
}

export async function runInteractiveTokenCommand(): Promise<void> {
  if (!isInteractiveTerminal()) {
    emitCliBlock({
      tone: "info",
      title: "Token command",
      note: "Use `city token --help` for scriptable usage, or run `city token` in an interactive terminal.",
    });
    return;
  }

  while (true) {
    const tokens = loadLocalCliTokens();

    const response = (await prompts({
      type: "select",
      name: "action",
      message: "选择 token 操作",
      choices: [
        {
          title: "浏览 token",
          description: `查看 ${tokens.length} 个 token 的详情和状态`,
          value: "browse",
        },
        {
          title: "创建 token",
          description: "签发新的 Bearer Token，并继续后续接入配置",
          value: "create",
        },
        {
          title: "删除 token",
          description: "删除已有 token",
          value: "delete",
        },
        {
          title: "退出",
          description: "结束交互式 token 管理",
          value: "exit",
        },
      ],
      initial: tokens.length > 0 ? 0 : 1,
    })) as { action?: string };

    const action = String(response.action || "").trim();
    if (!action || action === "exit") {
      emitCliBlock({
        tone: "info",
        title: "Token command finished",
      });
      return;
    }

    if (action === "browse") {
      await runInteractiveTokenBrowser();
      continue;
    }

    if (action === "create") {
      await runInteractiveCreateFlow();
      continue;
    }

    if (action === "delete") {
      const token_id = await promptTokenIdForDelete();
      if (!token_id) {
        continue;
      }
      deleteToken(token_id, false);
      continue;
    }
  }
}
