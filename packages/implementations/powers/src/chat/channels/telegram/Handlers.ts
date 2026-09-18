import type { PowerLogger } from "@downcity/city/power";
import type { TelegramUpdate, TelegramUser } from "./Shared.js";

/**
 * Telegram command/callback handlers。
 *
 * 关键点（中文）
 * - handler 通过参数接收 logger，不依赖全局 runtime
 * - 方便在不同运行环境复用（server / test）
 */

/**
 * Telegram 指令处理上下文。
 *
 * 说明（中文）
 * - 采用显式注入，避免 handler 反向依赖 server / core 单例
 */
export type TelegramHandlerContext = {
  logger: PowerLogger;
  sendMessage: (
    chatId: string,
    text: string,
    opts?: { messageThreadId?: number },
  ) => Promise<void>;
  clearChat: (chatId: string, messageThreadId?: number) => Promise<void>;
};

/**
 * 处理 Telegram 斜杠命令。
 *
 * 说明（中文）
 * - 当前只处理少量内置命令，其他消息走常规会话链路
 */
export async function handleTelegramCommand(
  ctx: TelegramHandlerContext,
  params: {
    chatId: string;
    command: string;
    from?: TelegramUser;
    messageThreadId?: number;
  },
): Promise<void> {
  const username = params.from?.username || "Unknown";
  ctx.logger.info(`Received command: ${params.command} (${username})`);

  const [commandToken] = params.command.trim().split(/\s+/);
  const cmd = (commandToken || "").split("@")[0]?.toLowerCase();

  switch (cmd) {
    case "/start":
    case "/help":
      await ctx.sendMessage(
        params.chatId,
        `🤖 Downcity Bot

Available commands:
- /status - View agent status
- /clear - Delete conversation completely
- <any message> - Execute instruction`,
      );
      break;

    case "/status":
      await ctx.sendMessage(params.chatId, "📊 Agent status: Running");
      break;

    case "/clear":
      await ctx.clearChat(params.chatId, params.messageThreadId);
      await ctx.sendMessage(params.chatId, "✅ Conversation deleted completely", {
        messageThreadId: params.messageThreadId,
      });
      break;

    default:
      await ctx.sendMessage(params.chatId, `Unknown command: ${params.command}`);
  }
}

/**
 * 处理 callback_query（按钮回调）。
 *
 * 当前策略（中文）
 * - 预留扩展点；默认不执行任何业务逻辑
 */
export async function handleTelegramCallbackQuery(
  ctx: TelegramHandlerContext,
  callbackQuery: TelegramUpdate["callback_query"],
): Promise<void> {
  void ctx;
  void callbackQuery;
}
