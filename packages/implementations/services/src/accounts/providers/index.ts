/**
 * Accounts provider 工厂统一入口。
 *
 * 关键说明（中文）
 * - Email / GitHub / Google / WeChat 都只是 AccountsService 的 provider。
 * - AccountsService 统一负责表、better-auth、token 签发与路由。
 */

export { emailAccountsProvider } from "./email.js";
export {
  githubAccountsProvider,
  googleAccountsProvider,
  oauthAccountsProvider,
  wechatAccountsProvider,
} from "./oauth.js";
