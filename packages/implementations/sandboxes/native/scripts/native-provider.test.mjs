/**
 * @file 原生隔离 Provider 的纯契约测试。
 *
 * 关键点（中文）
 * - 这些测试不启动围栏，只验证策略展开、平台包装与拒绝翻译的稳定契约。
 * - 真实围栏是否生效由 Provider.check() 的 canary 负责，这里不重复覆盖。
 */

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  NativeSandboxProvider,
  build_bubblewrap_prefix,
  build_seatbelt_profile,
  explain_sandbox_denial,
  resolve_sandbox_policy,
  resolve_wrapper_binary,
} from "../bin/index.js";

const workspace_path = "/projects/docs";
const runtime_path = "/downcity/city-a";
const home_path = process.env.HOME || "/home/user";

/** 构造一个最小 Workspace 绑定。 */
function create_binding(overrides = {}) {
  return {
    workspace_id: "docs",
    workspace_path,
    runtime_path,
    ...overrides,
  };
}

test("策略展开把 workspace 与 runtime 都列为可写根", () => {
  const policy = resolve_sandbox_policy({ binding: create_binding() });

  assert.ok(policy.writable_roots.includes(path.resolve(workspace_path)));
  assert.ok(policy.writable_roots.includes(path.resolve(runtime_path)));
  assert.equal(policy.network, "allow");
  assert.match(policy.digest, /^[a-f0-9]{16}$/);
});

test("同一绑定得到稳定摘要，绑定变化后摘要随之变化", () => {
  const first = resolve_sandbox_policy({ binding: create_binding() });
  const second = resolve_sandbox_policy({ binding: create_binding() });
  const changed = resolve_sandbox_policy({
    binding: create_binding({ workspace_path: "/projects/other" }),
  });

  assert.equal(first.digest, second.digest);
  assert.notEqual(first.digest, changed.digest);
});

test("授权目录按声明模式进入可写或只读规则", () => {
  const policy = resolve_sandbox_policy({
    binding: create_binding({
      granted_mounts: [
        { host_path: "/data/cache", access: "rw", reason: "build cache" },
        { host_path: "/data/shared", access: "ro", reason: "shared inputs" },
      ],
    }),
  });

  assert.ok(policy.writable_roots.includes("/data/cache"));
  assert.ok(!policy.writable_roots.includes("/data/shared"));
  assert.ok(policy.write_rules.some((rule) =>
    rule.path === "/data/shared" && rule.access === "ro"
  ));
});

test("出网策略可显式关闭", () => {
  const policy = resolve_sandbox_policy({ binding: create_binding({ network: "deny" }) });
  assert.equal(policy.network, "deny");
});

test("敏感目录进入读排除列表", () => {
  const policy = resolve_sandbox_policy({ binding: create_binding() });

  assert.ok(policy.deny_read_rules.some((rule) => rule.path === `${home_path}/.ssh`));
  assert.ok(policy.deny_read_rules.every((rule) => rule.source === "protected"));
});

test("seatbelt profile 用全局可读加排除，而不是路径白名单", () => {
  const policy = resolve_sandbox_policy({ binding: create_binding() });
  const profile = build_seatbelt_profile({ policy, env: { HOME: home_path } });

  assert.match(profile, /\(deny default\)/);
  assert.match(profile, /\(allow file-read\*\)/);
  assert.ok(!profile.includes("(allow file-read* (subpath"));
  assert.ok(profile.includes(`(deny file-read* (subpath "${home_path}/.ssh"))`));
  assert.ok(profile.includes(`(allow file-write* (subpath "${path.resolve(workspace_path)}"))`));
  assert.ok(profile.includes('(allow file-write* (subpath "/dev"))'));
});

test("seatbelt profile 在允许出网时放行 DNS 与 ssh-agent", () => {
  const policy = resolve_sandbox_policy({ binding: create_binding() });
  const profile = build_seatbelt_profile({
    policy,
    env: { HOME: home_path, SSH_AUTH_SOCK: "/var/run/agent.sock" },
  });

  assert.ok(profile.includes("(allow network-outbound)"));
  assert.ok(profile.includes('(allow network-outbound (literal "/var/run/mDNSResponder"))'));
  assert.ok(profile.includes('(allow network-outbound (literal "/var/run/agent.sock"))'));
});

test("禁止出网时 profile 不含任何 network-outbound", () => {
  const policy = resolve_sandbox_policy({ binding: create_binding({ network: "deny" }) });
  const profile = build_seatbelt_profile({ policy, env: { HOME: home_path } });

  assert.ok(!profile.includes("network-outbound"));
});

test("bubblewrap 前缀默认保留宿主网络", () => {
  const policy = resolve_sandbox_policy({ binding: create_binding() });
  const args = build_bubblewrap_prefix(policy);

  assert.ok(!args.includes("--unshare-net"));
  assert.ok(args.includes("--die-with-parent"));
  assert.equal(args.at(-1), "--");
  assert.ok(args.includes(path.resolve(workspace_path)));
});

test("bubblewrap 前缀在禁止出网时隔离网络命名空间", () => {
  const policy = resolve_sandbox_policy({ binding: create_binding({ network: "deny" }) });
  const args = build_bubblewrap_prefix(policy);

  assert.ok(args.includes("--unshare-net"));
});

test("包装器按平台解析，不支持平台返回 null", () => {
  assert.equal(resolve_wrapper_binary("darwin"), "/usr/bin/sandbox-exec");
  assert.equal(resolve_wrapper_binary("linux"), "/usr/bin/bwrap");
  assert.equal(resolve_wrapper_binary("win32"), null);
});

test("Provider 拒绝不完整的 Workspace 绑定", () => {
  const provider = new NativeSandboxProvider();

  assert.throws(
    () => provider.create_workspace({ workspace_id: "", workspace_path, runtime_path }),
    /requires workspace_id, workspace_path and runtime_path/,
  );
});

test("describe 回报语义授权而不是派生的系统规则", () => {
  const provider = new NativeSandboxProvider();
  const sandbox = provider.create_workspace(create_binding({
    granted_mounts: [{ host_path: "/data/shared", access: "ro", reason: "shared" }],
  }));
  const snapshot = sandbox.describe();

  assert.equal(snapshot.backend, "native");
  assert.equal(snapshot.workdir, path.resolve(workspace_path));
  assert.equal(snapshot.mounts.length, 2);
  assert.deepEqual(snapshot.mounts[0], {
    host_path: path.resolve(workspace_path),
    sandbox_path: path.resolve(workspace_path),
    mode: "rw",
  });
  assert.equal(snapshot.mounts[1].mode, "ro");
  assert.equal(snapshot.persistent, true);
});

test("拒绝翻译定位越界写入并给出可写根", () => {
  const policy = resolve_sandbox_policy({ binding: create_binding() });
  const explanation = explain_sandbox_denial({
    output: `/bin/sh: ${home_path}/secret.txt: Operation not permitted`,
    policy,
  });

  assert.ok(explanation);
  assert.equal(explanation.path, `${home_path}/secret.txt`);
  assert.equal(explanation.code, "write_denied");
  assert.ok(explanation.writable_roots.includes(path.resolve(workspace_path)));
});

test("拒绝翻译忽略可写范围内的路径，并跳过非权限问题", () => {
  const policy = resolve_sandbox_policy({ binding: create_binding() });
  const inside_write = explain_sandbox_denial({
    output: `/bin/sh: ${workspace_path}/out.txt: Operation not permitted`,
    policy,
  });
  const unrelated = explain_sandbox_denial({
    output: "command not found: foo",
    policy,
  });

  assert.equal(inside_write?.path, "");
  assert.equal(unrelated, null);
});

test("Provider 在无 launcher 时明确报错而不是静默降级", async () => {
  const provider = new NativeSandboxProvider();
  const sandbox = provider.create_workspace(create_binding());

  await assert.rejects(
    () => sandbox.spawn({
      execution_id: "sh_1",
      cmd: "true",
      cwd: path.resolve(workspace_path),
      shell_path: "/bin/sh",
      login: true,
      env: {},
    }),
    /requires a process launcher from the host/,
  );
});
