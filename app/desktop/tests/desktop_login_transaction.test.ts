/** Desktop Federation 登录事务测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Embassy, EmbassyAccountLoginResult } from "@downcity/federation";
import { DesktopLoginTransaction } from "../src/main/user/DesktopLoginTransaction.ts";

interface FakeLoginRuntime {
  /** Embassy 返回的启动结果。 */
  start_result: EmbassyAccountLoginResult;
  /** 每次轮询依次返回的结果。 */
  poll_results: EmbassyAccountLoginResult[];
  /** Embassy 当前保存的用户 Token。 */
  user_token?: string;
  /** 可选的自定义轮询实现。 */
  poll?(): Promise<EmbassyAccountLoginResult>;
}

function create_fake_embassy(runtime: FakeLoginRuntime): Embassy {
  return {
    user: {
      account: {
        login_start: async () => runtime.start_result,
        status: async () => runtime.poll ? runtime.poll() : runtime.poll_results.shift() || runtime.start_result,
        token: () => runtime.user_token,
      },
    },
  } as unknown as Embassy;
}

test("登录完成后只保存一次账户并消费事务", async () => {
  const completed: Array<{ federation_url: string; user_token: string }> = [];
  const runtime: FakeLoginRuntime = {
    start_result: { status: "redirect_required", login_id: "login_1", url: "https://login.example.com" },
    poll_results: [{ status: "done", login_id: "login_1", user_token: "token_1" }],
    user_token: "token_1",
  };
  const transaction = new DesktopLoginTransaction({
    now: () => 1_000,
    create_embassy: () => create_fake_embassy(runtime),
    complete_login: async (federation_url, user_token) => { completed.push({ federation_url, user_token }); },
  });

  const started = await transaction.start({ federation_url: "https://base.downcity.ai/", provider_id: "github" });
  assert.equal(started.status, "redirect_required");
  assert.deepEqual(await transaction.poll("login_1"), { status: "done", login_id: "login_1" });
  assert.deepEqual(completed, [{ federation_url: "https://base.downcity.ai", user_token: "token_1" }]);
  await assert.rejects(() => transaction.poll("login_1"), /登录请求已失效/u);
});

test("取消和过期事务不能继续轮询", async () => {
  let current_time = 1_000;
  const runtime: FakeLoginRuntime = {
    start_result: { status: "pending", login_id: "login_2" },
    poll_results: [],
  };
  const transaction = new DesktopLoginTransaction({
    now: () => current_time,
    create_embassy: () => create_fake_embassy(runtime),
    complete_login: async () => undefined,
  }, 100);

  await transaction.start({ federation_url: "https://base.downcity.ai", provider_id: "github" });
  transaction.cancel("login_2");
  await assert.rejects(() => transaction.poll("login_2"), /登录请求已失效/u);

  runtime.start_result = { status: "pending", login_id: "login_3" };
  await transaction.start({ federation_url: "https://base.downcity.ai", provider_id: "github" });
  current_time = 1_101;
  await assert.rejects(() => transaction.poll("login_3"), /登录请求已失效/u);
});

test("输入型 Provider 保持等待状态且不会保存账户", async () => {
  let completed = false;
  const runtime: FakeLoginRuntime = {
    start_result: {
      status: "input_required",
      login_id: "login_input",
      inputs: [{ name: "email", label: "Email", required: true }],
    },
    poll_results: [],
  };
  const transaction = new DesktopLoginTransaction({
    now: () => 1_000,
    create_embassy: () => create_fake_embassy(runtime),
    complete_login: async () => { completed = true; },
  });

  const result = await transaction.start({ federation_url: "https://base.downcity.ai", provider_id: "email" });
  assert.equal(result.status, "input_required");
  assert.equal(completed, false);
  transaction.cancel(result.login_id);
});

test("同一登录事务拒绝并发轮询", async () => {
  let release_poll: ((result: EmbassyAccountLoginResult) => void) | undefined;
  const runtime: FakeLoginRuntime = {
    start_result: { status: "pending", login_id: "login_concurrent" },
    poll_results: [],
    poll: () => new Promise((resolve) => { release_poll = resolve; }),
  };
  const transaction = new DesktopLoginTransaction({
    now: () => 1_000,
    create_embassy: () => create_fake_embassy(runtime),
    complete_login: async () => undefined,
  });

  await transaction.start({ federation_url: "https://base.downcity.ai", provider_id: "github" });
  const first_poll = transaction.poll("login_concurrent");
  await assert.rejects(() => transaction.poll("login_concurrent"), /正在查询中/u);
  release_poll?.({ status: "pending", login_id: "login_concurrent" });
  assert.deepEqual(await first_poll, { status: "pending", login_id: "login_concurrent" });
});
