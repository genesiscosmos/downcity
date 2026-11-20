/**
 * SSH 命令与交互会话。执行权限等同远程登录用户，不能声称拥有本地 Sandbox 隔离。
 * 会话只归当前 Workspace 所有，输出有界，取消/超时/释放会关闭 SSH 并由远端监督器清理进程组。
 */
import crypto from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";
import { define_agent_tool, type AgentTool, type ToolCallContext } from "@downcity/type";
import type { WorkspaceShell, WorkspaceShellSandboxCommandInput, WorkspaceShellSandboxCommandResult } from "@downcity/type/shell";
import type { SshProcessSession, SshCommandOptions } from "./types/Ssh.js";
import type { SshConnection } from "./SshConnection.js";
import { ssh_runtime_command } from "./SshInitialization.js";
import { SshFileSystem } from "./SshFileSystem.js";
import { remote_shell_program } from "./RemoteShellProgram.js";
const command_schema = z.object({ cmd: z.string().min(1).max(64000), workdir: z.string().optional(), shell: z.string().optional(), login: z.boolean().optional(), timeout_ms: z.number().min(1).max(60000).optional(), max_output_tokens: z.number().min(1).max(32000).optional(), target: z.enum(["sandbox", "host"]).optional() }).passthrough();
const session_schema = z.object({ action: z.enum(["start", "send", "read", "list", "stop"]), shell_id: z.string().optional(), cmd: z.string().min(1).max(64000).optional(), input: z.string().max(1024 * 1024).optional(), workdir: z.string().optional(), shell: z.string().optional(), login: z.boolean().optional(), cols: z.number().int().min(1).max(1000).optional(), rows: z.number().int().min(1).max(1000).optional(), max_output_tokens: z.number().min(1).max(32000).optional(), inline_wait_ms: z.number().min(0).max(10000).optional(), wait_ms: z.number().min(0).max(10000).optional(), target: z.enum(["sandbox", "host"]).optional() }).passthrough();
/** 远程 Shell，不把宿主 env 或本地凭据传给远端进程。 */
export class SshShell implements WorkspaceShell {
    readonly tools: Record<string, AgentTool>;
    private env: Readonly<Record<string, string>> = {};
    private readonly sessions = new Map<string, SshProcessSession>();
    constructor(private readonly connection: SshConnection, private readonly files: SshFileSystem) {
        this.tools = {
            shell_exec: define_agent_tool({ description: "Execute on the SSH host as the connected user, without local Sandbox isolation. Local host execution is unavailable.", input_schema: command_schema, execute: async (input, context) => {
                    context.abort_signal?.throwIfAborted();
                    const parsed = command_schema.parse(input);
                    const session = await this.start(parsed, context);
                    const stop = () => session.process.kill("SIGKILL");
                    if (context.abort_signal?.aborted) {
                        stop();
                        throw new Error("SSH command cancelled after submission; inspect remote state before retrying");
                    }
                    context.abort_signal?.addEventListener("abort", stop, { once: true });
                    const timer = setTimeout(stop, parsed.timeout_ms ?? 30000);
                    try {
                        await new Promise<void>((resolve) => { if (session.exit_code !== null)
                            resolve();
                        else
                            session.process.once("close", () => resolve()); });
                        return this.snapshot(session, parsed.max_output_tokens);
                    }
                    finally {
                        clearTimeout(timer);
                        context.abort_signal?.removeEventListener("abort", stop);
                        this.sessions.delete(session.id);
                    }
                } }),
            shell_session: define_agent_tool({ description: "Manage SSH remote interactive processes; closing the channel terminates its supervised process group.", input_schema: session_schema, execute: async (input, context) => {
                    context.abort_signal?.throwIfAborted();
                    const parsed = session_schema.parse(input);
                    if (parsed.action === "list")
                        return { success: true, execution_backend: "ssh", sessions: [...this.sessions.values()].filter((item) => item.owner_context_id === this.owner_id(context)).map((item) => this.snapshot(item, 100, false)) };
                    if (parsed.action === "start") {
                        const session = await this.start({ ...parsed, cmd: parsed.cmd || "", terminal: true }, context);
                        if (context.abort_signal?.aborted) {
                            session.process.kill("SIGKILL");
                            throw new Error("SSH session cancelled after submission");
                        }
                        await this.wait_output(session, parsed.inline_wait_ms ?? 100);
                        return this.snapshot(session, parsed.max_output_tokens);
                    }
                    const session = this.sessions.get(parsed.shell_id || "");
                    if (!session || session.owner_context_id !== this.owner_id(context))
                        throw new Error("SSH shell session not found");
                    if (parsed.action === "send") {
                        if (session.exit_code !== null)
                            throw new Error("SSH shell session has exited; input was not submitted");
                        const raw_input = parsed.input || "";
                        if (raw_input.includes("${secrets.") && !context.interactions) throw new Error("Session private input is unavailable");
                        const resolved = context.interactions?.resolve_secret_references(raw_input) ?? raw_input;
                        if (typeof resolved !== "string" || Buffer.byteLength(resolved) > 1024 * 1024) throw new Error("SSH stdin exceeds its input limit");
                        session.process.stdin.write(resolved);
                        await this.wait_output(session, parsed.wait_ms ?? 100);
                    }
                    if (parsed.action === "stop") {
                        await new Promise<void>((resolve) => { if (session.exit_code !== null)
                            resolve();
                        else {
                            session.process.once("close", () => resolve());
                            session.process.kill("SIGKILL");
                        } });
                        this.sessions.delete(session.id);
                    }
                    return this.snapshot(session, parsed.max_output_tokens);
                } }),
        };
    }
    bind(): void { }
    set_env(env: Readonly<Record<string, string>>): void { this.env = { ...env }; }
    describe_sandbox(): null { return null; }
    async reset_sandbox(): Promise<void> { throw new Error("SSH Workspace has no local Sandbox to reset"); }
    has_active_sessions(): boolean { return [...this.sessions.values()].some((session) => session.exit_code === null); }
    private owner_id(context: ToolCallContext): string { return `${context.agent_id}:${context.session_type}:${context.session_id}`; }
    private async start(input: SshCommandOptions, context?: ToolCallContext): Promise<SshProcessSession> {
        const serialized = JSON.stringify(input);
        if (serialized.includes("${secrets.") || (context?.interactions && JSON.stringify(context.interactions.redact_secret_values(input)) !== serialized)) throw new Error("Private values are only supported in SSH session stdin, not command source or connection parameters");
        const redactor = context?.interactions?.create_secret_stream_redactor();
        if (input.target === "host")
            throw new Error("SSH Workspace cannot execute on the Desktop host");
        if (!input.cmd.trim())
            throw new Error("cmd is required");
        if (this.sessions.size >= 64) {
            for (const [id, session] of this.sessions)
                if (session.exit_code !== null)
                    this.sessions.delete(id);
            if (this.sessions.size >= 64)
                throw new Error("SSH Workspace has too many active sessions");
        }
        const cwd = this.files.resolve_path(input.workdir || ".");
        if (!(await this.files.stat(cwd)).is_directory)
            throw new Error("Remote working directory is not a directory");
        context?.abort_signal?.throwIfAborted();
        const payload = Buffer.from(JSON.stringify({ ...input, cwd, env: { ...this.env, ...input.env } })).toString("base64");
        const child = this.connection.start(ssh_runtime_command('exec python3 -c "$1" "$2"', remote_shell_program, payload));
        const session: SshProcessSession = { id: `ssh_${crypto.randomUUID()}`, process: child, owner_context_id: context ? this.owner_id(context) : undefined, output: "", truncated: false, exit_code: null, cleanup: () => { } };
        this.sessions.set(session.id, session);
        const stdout_decoder = new StringDecoder("utf8");
        const stderr_decoder = new StringDecoder("utf8");
        let redaction_failed = false;
        const append = (text: string, final = false) => {
            if (redaction_failed) return;
            try {
                const safe = redactor ? (final ? redactor.write(text) + redactor.end() : redactor.write(text)) : text;
                session.output += safe;
                if (session.output.length > 256000) { session.output = session.output.slice(-256000); session.truncated = true; }
            } catch {
                redaction_failed = true;
                session.output = "";
                session.error = "SSH output redaction failed; output was suppressed and process termination requested";
                child.kill("SIGKILL");
            }
        };
        child.stdout.on("data", (chunk: Buffer) => append(stdout_decoder.write(chunk)));
        child.stderr.on("data", (chunk: Buffer) => append(stderr_decoder.write(chunk)));
        session.cleanup = () => append(stdout_decoder.end() + stderr_decoder.end(), true);
        child.stdin.on("error", (error) => { session.error = `${error.message}; input may have been submitted. Inspect remote state before retrying.`; });
        child.on("error", (error) => { session.error = error.message; });
        child.once("close", (code) => { session.exit_code = code ?? 255; if (code === null || code === 255)
            session.error = "SSH connection closed; command result may be unknown. It was not replayed."; session.cleanup(); });
        return session;
    }
    /** 只等待下一块输出或退出；计时器与监听在任何完成分支释放。 */
    private async wait_output(session: SshProcessSession, wait_ms: number): Promise<void> {
        if (session.exit_code !== null || wait_ms <= 0)
            return;
        await new Promise<void>((resolve) => {
            const finish = () => {
                clearTimeout(timer);
                session.process.stdout.removeListener("data", finish);
                session.process.stderr.removeListener("data", finish);
                session.process.removeListener("close", finish);
                resolve();
            };
            const timer = setTimeout(finish, wait_ms);
            session.process.stdout.once("data", finish);
            session.process.stderr.once("data", finish);
            session.process.once("close", finish);
        });
    }
    private snapshot(session: SshProcessSession, max_output_tokens = 4000, consume = true) {
        const limit = Math.max(1, Math.min(max_output_tokens, 32000)) * 4;
        const output = session.output.slice(0, limit);
        if (consume) session.output = session.output.slice(output.length);
        return { success: !session.error && (session.exit_code === null || session.exit_code === 0), shell_id: session.id, status: session.exit_code === null ? "running" : session.exit_code === 0 ? "completed" : "failed", execution_backend: "ssh", isolation: "remote_user", exit_code: session.exit_code, output, truncated: session.truncated || session.output.length > 0, ...(session.error ? { error: session.error } : session.exit_code !== null && session.exit_code !== 0 ? { error: `SSH command exited with code ${session.exit_code}` } : {}) };
    }
    /** 适配既有 Shell SDK 入口；结果明确标记 ssh 后端，始终使用远程用户权限。 */
    async run_sandbox_command(input: WorkspaceShellSandboxCommandInput): Promise<WorkspaceShellSandboxCommandResult> {
        const session = await this.start({ cmd: input.cmd, workdir: input.cwd, shell: input.shell_path, login: input.login, env: input.env, terminal: input.terminal, cols: input.cols, rows: input.rows });
        const timer = setTimeout(() => session.process.kill("SIGKILL"), 60000);
        try {
            await new Promise<void>((resolve) => { if (session.exit_code !== null)
                resolve();
            else
                session.process.once("close", () => resolve()); });
            if (session.error || session.exit_code !== 0)
                throw new Error(session.error || session.output || `SSH command exited with code ${session.exit_code}`);
            if (session.truncated)
                throw new Error("SSH command output exceeded the bounded SDK output buffer; use shell sessions for incremental reads");
            const process = session.process;
            return { stdout: session.output, stderr: "", exit_code: session.exit_code, spawn: { backend: "ssh", cwd: this.files.resolve_path(input.cwd), child: {
                        get writable() { return process.stdin.writable; },
                        on_data: (callback) => { process.stdout.on("data", callback); process.stderr.on("data", callback); },
                        on_exit: (callback) => { if (session.exit_code !== null)
                            callback(session.exit_code);
                        else
                            process.once("close", (code) => callback(code ?? 255)); },
                        on_error: (callback) => { process.on("error", callback); },
                        write: async (chars) => { await new Promise<void>((resolve, reject) => process.stdin.write(chars, (error) => error ? reject(error) : resolve())); },
                        kill: () => { process.kill("SIGKILL"); },
                    } } };
        }
        finally {
            clearTimeout(timer);
            this.sessions.delete(session.id);
        }
    }
    async dispose(): Promise<void> {
        await Promise.all([...this.sessions.values()].map(async (session) => {
            if (session.exit_code !== null)
                return;
            await new Promise<void>((resolve) => { session.process.once("close", () => resolve()); session.process.kill("SIGKILL"); });
        }));
        this.sessions.clear();
    }
}
