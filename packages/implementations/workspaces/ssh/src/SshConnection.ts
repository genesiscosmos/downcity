/**
 * 系统 OpenSSH 传输。每个请求单独持有子进程，不建立控制主连接或远程服务。
 * 默认严格验证 known_hosts；登记时通过 askpass 只展示主机身份，精确确认后由 SSH 写入 known_hosts。
 * 密码、键盘交互及代理转发禁用，认证只使用系统配置和已有密钥/认证代理。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SshHostChallenge, SshRequestOptions } from "./types/Ssh.js";
/** POSIX shell 单参数编码；源码与参数始终分开处理。 */
export function quote_posix(value: string): string {
    if (value.includes("\0"))
        throw new Error("NUL is not allowed in SSH arguments");
    return `'${value.replaceAll("'", `'"'"'`)}'`;
}
/** 校验连接目标，阻止 OpenSSH 选项注入。 */
export function normalize_ssh_host(value: string): string {
    const host = String(value || "").trim();
    if (!host || host.startsWith("-") || !/^[a-zA-Z0-9_@.:[\]%-]+$/u.test(host))
        throw new Error("SSH host must be a Host alias or user@host without whitespace");
    return host;
}
/** 未知主机必须由可信 UI 明确确认；普通执行不得自动接受。 */
export class SshHostKeyError extends Error {
    constructor(readonly challenge: SshHostChallenge) { super(challenge.prompt); this.name = "SshHostKeyError"; }
}
/** 持有 OpenSSH 子进程并统一清理、超时、取消和错误语义。 */
export class SshConnection {
    readonly host: string;
    private readonly processes = new Set<ChildProcessWithoutNullStreams>();
    private disposed = false;
    /** config_path 仅由只读浏览快照提供，不接受 Renderer 的本机路径。 */
    constructor(host: string, private readonly config_path?: string) { this.host = normalize_ssh_host(host); }
    /** 创建受严格主机检查约束的远程进程；调用方拥有 stdin 和完成处理。 */
    start(command: string, terminal = false, extra_env: Record<string, string> = {}, checking = "yes"): ChildProcessWithoutNullStreams {
        if (this.disposed)
            throw new Error("SSH Workspace has been disposed");
        const args = [
            "-o", `StrictHostKeyChecking=${checking}`, "-o", `BatchMode=${checking === "ask" ? "no" : "yes"}`,
            "-o", "UpdateHostKeys=no", "-o", "VerifyHostKeyDNS=no",
            "-o", "PasswordAuthentication=no", "-o", "KbdInteractiveAuthentication=no",
            "-o", "ForwardAgent=no", "-o", "ClearAllForwardings=yes", "-o", "PermitLocalCommand=no",
            "-o", "ControlMaster=no", "-o", "ControlPath=none",
            "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2",
            terminal ? "-tt" : "-T",
        ];
        if (this.config_path)
            args.unshift("-F", this.config_path, "-o", "RemoteCommand=none", "-o", "KnownHostsCommand=none", "-o", "RequestTTY=no", "-o", "SessionType=default", "-o", "ForkAfterAuthentication=no");
        if (checking === "ask")
            args.push("-o", "NumberOfPasswordPrompts=0");
        args.push("--", this.host, command);
        const child = spawn("ssh", args, { env: { ...process.env, LC_ALL: "C", ...extra_env }, stdio: "pipe" });
        this.processes.add(child);
        child.once("close", () => this.processes.delete(child));
        return child;
    }
    /** 执行一次请求；副作用请求失败永不重放，保留“结果未知”语义。 */
    async request(command: string, options: SshRequestOptions = {}): Promise<string> {
        options.signal?.throwIfAborted();
        let temporary_path: string | undefined;
        let prompt_path: string | undefined;
        let extra_env: Record<string, string> = {};
        if (options.discover_host) {
            temporary_path = await mkdtemp(path.join(os.tmpdir(), "downcity-ssh-"));
            prompt_path = path.join(temporary_path, "prompt");
            const helper_path = path.join(temporary_path, "askpass");
            await writeFile(helper_path, '#!/bin/sh\nprintf "%s" "$1" > "$DOWNCITY_SSH_PROMPT_PATH"\nif [ -n "$DOWNCITY_SSH_CONFIRMED_PROMPT" ] && [ "$1" = "$DOWNCITY_SSH_CONFIRMED_PROMPT" ]; then printf "yes\\n"; else printf "no\\n"; fi\n', { mode: 0o700 });
            extra_env = { SSH_ASKPASS: helper_path, SSH_ASKPASS_REQUIRE: "force", DISPLAY: "downcity:0", DOWNCITY_SSH_PROMPT_PATH: prompt_path, DOWNCITY_SSH_CONFIRMED_PROMPT: options.confirmed_prompt || "" };
        }
        try {
            options.signal?.throwIfAborted();
            return await new Promise<string>((resolve, reject) => {
                const child = this.start(command, false, extra_env, options.discover_host ? "ask" : "yes");
                const chunks: Buffer[] = [];
                let stderr = "";
                let bytes = 0;
                let failure: Error | undefined;
                let submitted = false;
                child.once("spawn", () => { submitted = true; });
                const stop = (error: Error) => { failure ??= error; child.kill("SIGKILL"); };
                const abort = () => stop(new Error("SSH request cancelled"));
                const timer = setTimeout(() => stop(new Error("SSH request timed out")), options.timeout_ms ?? 30000);
                options.signal?.addEventListener("abort", abort, { once: true });
                child.stdout.on("data", (chunk: Buffer) => {
                    bytes += chunk.length;
                    if (bytes > (options.max_bytes ?? 90 * 1024 * 1024))
                        stop(new Error("SSH response exceeds output limit"));
                    else
                        chunks.push(chunk);
                });
                child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-16384); });
                child.stdin.on("error", () => { });
                child.on("error", (error) => { failure ??= error; });
                child.once("close", async (code) => {
                    clearTimeout(timer);
                    options.signal?.removeEventListener("abort", abort);
                    if (!failure && code === 0) {
                        resolve(Buffer.concat(chunks).toString("utf8"));
                        return;
                    }
                    const prompt = prompt_path ? await readFile(prompt_path, "utf8").catch(() => "") : "";
                    if (!failure && prompt && prompt !== options.confirmed_prompt && /SHA256:/u.test(prompt) && /authenticity|fingerprint/iu.test(prompt)) {
                        reject(new SshHostKeyError({ host: this.host, prompt }));
                        return;
                    }
                    const message = failure?.message || stderr.trim() || `SSH exited with code ${code}`;
                    reject(new Error(options.mutation ? submitted ? `${message}. Request was submitted; remote result may be unknown. Inspect before retrying; it was not replayed.` : `${message}. Request was not submitted.` : message));
                });
                if (options.signal?.aborted) abort();
                else child.stdin.end(options.input);
            });
        }
        finally {
            if (temporary_path)
                await rm(temporary_path, { recursive: true, force: true });
        }
    }
    /** 关闭所有本地 SSH 通道；远程进程收到通道关闭，远端不保留服务。 */
    async dispose(): Promise<void> {
        this.disposed = true;
        await Promise.all([...this.processes].map(async (child) => {
            if (child.exitCode !== null)
                return;
            await new Promise<void>((resolve) => { child.once("close", () => resolve()); child.kill("SIGKILL"); });
        }));
    }
}
