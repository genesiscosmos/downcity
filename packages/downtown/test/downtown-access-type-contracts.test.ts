/**
 * Downtown 正式公开 API 类型契约测试。
 */

import type {
  Downtown,
  DowntownOptions,
  DowntownAccountProvider,
  DowntownAdminSession,
  DowntownCurrentUser,
} from "../src/index.js";

declare const downtown: Downtown;

const providers: Promise<DowntownAccountProvider[]> = downtown.user.account.providers();
const current_user: Promise<DowntownCurrentUser> = downtown.user.current();
const admin_session: Promise<DowntownAdminSession> = downtown.admin.login({
  admin_id: "owner",
  password: "password",
});
const invalid_options: DowntownOptions = {
  url: "https://fed.example.com",
  // @ts-expect-error City 来源属于用户视图，不属于 Downtown 宿主身份
  city_id: "city_product",
};

void providers;
void current_user;
void admin_session;
void invalid_options;

// @ts-expect-error Downtown 只有 user 和 admin 两个身份子域
void downtown.bureau;

// @ts-expect-error 管理员身份不暴露来源识别或机器授权
void downtown.admin.identify;

// @ts-expect-error 管理端没有产品机器注册表
void downtown.admin.bureaus;
const source_user = downtown.user.with_city("city_product");
void source_user;
