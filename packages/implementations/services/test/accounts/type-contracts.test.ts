/**
 * Accounts 服务类型契约测试。
 */

import { Downtown } from "@downcity/downtown";
import { AccountsService, emailAccountsProvider, githubAccountsProvider } from "../../src/index.js";

const base = new Downtown({ database: {} as never });

base.use(new AccountsService({
  token_ttl: "7d",
  providers: [
    emailAccountsProvider({
      send_email: async () => {},
    }),
    githubAccountsProvider(),
  ],
}));
