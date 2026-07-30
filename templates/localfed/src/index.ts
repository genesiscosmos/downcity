#!/usr/bin/env node

/**
 * 完整但克制的本地 Federation 模板。
 *
 * 只装配一条可直接体验的主链路：SQLite 持久化、Local Account 登录、
 * AIService 文本模型与本机 HTTP 服务。
 */

import { serve } from "@hono/node-server";
import { AIService, Federation } from "@downcity/city";
import { Database } from "@downcity/database-sqlite";
import { AccountsService } from "@downcity/services";
import { DeepSeekChannel } from "./deepseek_channel.js";

const host = process.env.HOST?.trim() || "127.0.0.1";
const port = Number(process.env.PORT || 43127);
const database_path = process.env.DATABASE_PATH?.trim() || "./localfed.sqlite";
const local_login = process.env.LOCAL_LOGIN !== "false";

if (local_login && host !== "127.0.0.1" && host !== "localhost") {
  throw new Error("Local Account 只能监听 127.0.0.1 或 localhost");
}
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT 必须是有效端口");
}

const federation = new Federation({
  database: new Database({ filename: database_path }),
});

federation.use(new AccountsService({ local_login }));

const deepseek = new DeepSeekChannel();
const ai = new AIService();
ai.use(deepseek.model({
  id: "deepseek-chat",
  upstream_model: "deepseek-chat",
  name: "DeepSeek Chat",
}));
federation.use(ai);

await federation.health();
serve({
  fetch: (request) => federation.fetch(request),
  hostname: host,
  port,
});

console.log(`Local Federation: http://${host}:${port}`);
console.log(`SQLite: ${database_path}`);
