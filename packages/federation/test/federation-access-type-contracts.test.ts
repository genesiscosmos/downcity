/**
 * Federation 正式公开 API 类型契约测试。
 */

import type {
  Downtown,
  FederationOptions,
  FederationAccountProvider,
  FederationAdminSession,
  FederationCurrentUser,
} from "../src/index.js";

declare const federation: Downtown;

const providers: Promise<FederationAccountProvider[]> = federation.user.account.providers();
const current_user: Promise<FederationCurrentUser> = federation.user.current();
const admin_session: Promise<FederationAdminSession> = federation.admin.login({
  admin_id: "owner",
  password: "password",
});
const invalid_options: FederationOptions = {
  url: "https://fed.example.com",
  // @ts-expect-error City 来源属于用户视图，不属于 Federation 宿主身份
  city_id: "city_product",
};

void providers;
void current_user;
void admin_session;
void invalid_options;

// @ts-expect-error Federation 只有 user 和 admin 两个身份子域
void federation.bureau;

// @ts-expect-error 管理员身份不暴露来源识别或机器授权
void federation.admin.identify;

// @ts-expect-error 管理端没有产品机器注册表
void federation.admin.bureaus;
const source_user = federation.user.with_city("city_product");
void source_user;
