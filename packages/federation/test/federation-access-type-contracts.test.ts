/**
 * Federation 正式公开 API 类型契约测试。
 */

import type {
  BureauTokenIssueResult,
  BureauTokenSummary,
  BureauRecord,
  Federation,
  FederationOptions,
  FederationAccountProvider,
  FederationAdminSession,
  FederationCurrentUser,
} from "../src/index.js";

declare const federation: Federation;

const providers: Promise<FederationAccountProvider[]> = federation.user.account.providers();
const current_user: Promise<FederationCurrentUser> = federation.user.current();
const admin_session: Promise<FederationAdminSession> = federation.admin.login({
  admin_id: "owner",
  password: "password",
});
const bureaus: Promise<BureauRecord[]> = federation.admin.bureaus.list();
const issued_token: Promise<BureauTokenIssueResult> = federation.admin.bureaus.tokens.issue({
  bureau_id: "product-web",
  purpose: "production backend",
});
const tokens: Promise<BureauTokenSummary[]> = federation.admin.bureaus.tokens.list();

const invalid_options: FederationOptions = {
  url: "https://fed.example.com",
  // @ts-expect-error bureau_id 属于登录请求，不属于 Federation 构造参数
  bureau_id: "product-web",
};

void providers;
void current_user;
void admin_session;
void bureaus;
void issued_token;
void tokens;
void invalid_options;

// @ts-expect-error Federation 只有 user 和 admin 两个身份子域
void federation.bureau;

// @ts-expect-error Bureau 身份与 Federation Admin 解耦
void federation.admin.identify;
