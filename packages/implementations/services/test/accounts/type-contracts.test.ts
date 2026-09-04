/**
 * Accounts 服务类型契约测试。
 */

import { Federation } from "@downcity/federation";
import { AccountsService, emailAccountsProvider, githubAccountsProvider } from "../../src/index.js";

const base = new Federation({ database: {} as never });

base.use(new AccountsService({
  token_ttl: "7d",
  providers: [
    emailAccountsProvider({
      send_email: async () => {},
    }),
    githubAccountsProvider(),
  ],
}));
