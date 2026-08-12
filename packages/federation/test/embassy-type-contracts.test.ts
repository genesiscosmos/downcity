/**
 * Embassy 正式公开 API 类型契约测试。
 */

import type {
  BureauTokenIssueResult,
  BureauTokenSummary,
  BureauRecord,
  Embassy,
  EmbassyAccountProvider,
  EmbassyAdminSession,
  EmbassyCurrentUser,
} from "../src/index.js";

declare const embassy: Embassy;

const providers: Promise<EmbassyAccountProvider[]> = embassy.user.account.providers();
const current_user: Promise<EmbassyCurrentUser> = embassy.user.current();
const admin_session: Promise<EmbassyAdminSession> = embassy.admin.login({
  admin_id: "owner",
  password: "password",
});
const bureaus: Promise<BureauRecord[]> = embassy.admin.bureaus.list();
const issued_token: Promise<BureauTokenIssueResult> = embassy.admin.bureaus.tokens.issue({
  bureau_id: "product-web",
  purpose: "production backend",
});
const tokens: Promise<BureauTokenSummary[]> = embassy.admin.bureaus.tokens.list();

void providers;
void current_user;
void admin_session;
void bureaus;
void issued_token;
void tokens;

// @ts-expect-error Embassy 只有 user 和 admin 两个身份子域
void embassy.bureau;

// @ts-expect-error Bureau 身份与 Embassy Admin 解耦
void embassy.admin.identify;
