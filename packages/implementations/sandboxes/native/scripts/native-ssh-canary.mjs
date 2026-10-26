/**
 * SSH 授权端点真实验收：仅生成临时密钥和专用 ssh-agent，不接触用户身份。
 * 验证受保护目录内的 socket 可签名、known_hosts 可读不可写、私钥不可读，
 * 未授权 socket 环境被移除，以及未知主机校验配置保持严格。
 * 在外层宿主执行；macOS 不支持嵌套 Seatbelt。探针和代理均在结束时清理。
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import { resolve_sandbox_policy, wrap_sandbox_invocation } from "../bin/index.js";
import { authorize_ssh, apply_ssh_environment } from "../bin/policy/SshAccess.js";
import { sanitize_process_environment } from "../bin/policy/ProcessEnvironment.js";

const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "dc-ssh-")));
let agent;
let ssh_server;
try {
  const protected_path = path.join(root, "protected");
  await mkdir(protected_path);
  const socket_path = path.join(protected_path, "agent.sock");
  const key_path = path.join(protected_path, "identity");
  const known_hosts_path = path.join(protected_path, "known_hosts");
  await writeFile(known_hosts_path, "canary-host-trust\n");
  const generate = spawnSync("/usr/bin/ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key_path], { encoding: "utf8" });
  assert.equal(generate.status, 0, generate.stderr);
  // 独立代理，只加载临时密钥，绝不连接进程原有的 SSH_AUTH_SOCK。
  agent = spawn("/usr/bin/ssh-agent", ["-D", "-a", socket_path], { stdio: "ignore" });
  const env = { ...process.env, SSH_AUTH_SOCK: socket_path };
  let loaded = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    const added = spawnSync("/usr/bin/ssh-add", [key_path], { env, encoding: "utf8" });
    if (added.status === 0) { loaded = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(loaded, "temporary ssh-agent could not load the test key");
  const public_key = path.join(root, "identity.pub");
  await writeFile(public_key, await readFile(`${key_path}.pub`));
  const base = resolve_sandbox_policy({ binding: { workspace_id: "ssh-canary", workspace_path: root, runtime_path: root, network: "allow" } });
  const restricted = { ...base, filesystem_rules: [...base.filesystem_rules, { path: protected_path, access: "deny", scope: "subpath", source: "protected" }] };
  const policy = authorize_ssh(restricted, { socket_path, known_hosts_path });
  function run(command, args, selected_policy = policy, input) {
    const clean_env = sanitize_process_environment(env);
    apply_ssh_environment(clean_env, selected_policy);
    const wrapped = wrap_sandbox_invocation({ platform: process.platform, policy: selected_policy, invocation: { command, args }, env: clean_env });
    return spawnSync(wrapped.command, wrapped.args, { env: clean_env, encoding: "utf8", input, timeout: 5000 });
  }
  const signed = run("/usr/bin/ssh-keygen", ["-Y", "sign", "-U", "-f", public_key, "-n", "downcity-canary"], policy, "temporary payload\n");
  assert.equal(signed.status, 0, signed.stderr);
  assert.match(signed.stdout, /BEGIN SSH SIGNATURE/);
  const denied = run("/bin/cat", [key_path]);
  assert.notEqual(denied.stdout, await readFile(key_path, "utf8"), "private key leaked");
  const hosts = run("/bin/cat", [known_hosts_path]);
  assert.equal(hosts.status, 0, hosts.stderr);
  assert.equal(hosts.stdout, "canary-host-trust\n");
  const write_denied = run("/bin/sh", ["-c", 'printf changed > "$1"', "canary", known_hosts_path]);
  assert.notEqual(write_denied.status, 0);
  const unauthorized = run("/usr/bin/ssh-add", ["-l"], restricted);
  assert.notEqual(unauthorized.status, 0, "unauthorized socket was usable");
  const clean_env = sanitize_process_environment(env);
  apply_ssh_environment(clean_env, policy);
  const config = run("/bin/sh", ["-c", `${clean_env.GIT_SSH_COMMAND} -G example.invalid`]);
  assert.equal(config.status, 0, config.stderr);
  assert.match(config.stdout, /stricthostkeychecking true|stricthostkeychecking yes/);
  assert.match(config.stdout, /forwardagent no/);
  let authentication = "not_requested";
  let git_push = "not_requested";
  if (process.argv.includes("--authentication")) {
    const host_key = path.join(root, "host-key");
    const generated = spawnSync("/usr/bin/ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", host_key], { encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);
    const listener = createServer();
    await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    const server_config = path.join(root, "sshd_config");
    await writeFile(server_config, [
      `Port ${port}`, "ListenAddress 127.0.0.1", `HostKey ${host_key}`,
      `AuthorizedKeysFile ${public_key}`, "StrictModes no", "UsePAM no",
      "PasswordAuthentication no", "KbdInteractiveAuthentication no", "PubkeyAuthentication yes",
      "AllowAgentForwarding no", "AllowTcpForwarding no", `PidFile ${root}/sshd.pid`,
    ].join("\n") + "\n");
    let server_error = "";
    ssh_server = spawn("/usr/sbin/sshd", ["-D", "-e", "-f", server_config], { stdio: ["ignore", "ignore", "pipe"] });
    ssh_server.stderr.on("data", (chunk) => { server_error += chunk; });
    await writeFile(known_hosts_path, `[127.0.0.1]:${port} ${await readFile(`${host_key}.pub`, "utf8")}`);
    let authenticated;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (ssh_server.exitCode !== null) throw new Error(`local sshd failed: ${server_error}`);
      authenticated = run("/bin/sh", ["-c", `${clean_env.GIT_SSH_COMMAND} -p ${port} ${os.userInfo().username}@127.0.0.1 'printf authenticated'`]);
      if (authenticated.status === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(authenticated.status, 0, `${authenticated.stderr}\n${server_error}`);
    assert.equal(authenticated.stdout, "authenticated");
    // 远端为本地专用 sshd 后的临时 bare 仓库；不接触现有仓库或公网。
    const repository = path.join(root, "source");
    const remote = path.join(root, "remote.git");
    function git(args, sandboxed = true) {
      const result = sandboxed ? run("/usr/bin/git", args)
        : spawnSync("/usr/bin/git", args, { encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    }
    git(["init", "--bare", remote], false);
    git(["init", repository]);
    await writeFile(path.join(repository, "README.md"), "temporary push probe\n");
    git(["-C", repository, "add", "README.md"]);
    git(["-C", repository, "-c", "user.name=Sandbox Canary", "-c", "user.email=canary@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "temporary probe"]);
    const revision = git(["-C", repository, "rev-parse", "HEAD"]);
    git(["-C", repository, "push", `ssh://${os.userInfo().username}@127.0.0.1:${port}${remote}`, "HEAD:refs/heads/canary"]);
    assert.equal(git(["--git-dir", remote, "rev-parse", "refs/heads/canary"], false), revision);
    git_push = "passed_with_remote_revision_verified";
    await writeFile(known_hosts_path, "");
    const unknown = run("/bin/sh", ["-c", `${clean_env.GIT_SSH_COMMAND} -p ${port} ${os.userInfo().username}@127.0.0.1 true`]);
    assert.notEqual(unknown.status, 0, "unknown host must be rejected");
    assert.match(unknown.stderr, /Host key verification failed/);
    authentication = "passed_with_unknown_host_rejected";
  }
  console.log(JSON.stringify({ platform: process.platform, signing: true, private_key_hidden: true, known_hosts_readonly: true, unauthorized_socket_blocked: true, strict_host_checking: true, authentication, git_push }));
} finally {
  if (ssh_server && ssh_server.exitCode === null) {
    const stopped = new Promise((resolve) => ssh_server.once("exit", resolve));
    ssh_server.kill("SIGTERM");
    await stopped;
  }
  if (agent && agent.exitCode === null) {
    const closed = new Promise((resolve) => agent.once("exit", resolve));
    agent.kill("SIGTERM");
    await closed;
  }
  await rm(root, { recursive: true, force: true });
}
