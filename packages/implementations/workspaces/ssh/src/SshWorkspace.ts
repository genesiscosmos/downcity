/**
 * Linux/macOS SSH Workspace 组合根。配置构造不连接网络；连接验证由显式 validate 完成。
 * 项目文件和命令在远端，Agent/Session/附件持久化仍由 City 当前宿主持有。
 */
import path from "node:path";
import { create_workspace_file_mutation_effect } from "@downcity/type/workspace";
import { z } from "zod";
import { define_agent_tool, type ToolEffect } from "@downcity/type";
import type { WorkspaceRuntime, WorkspaceTools, WorkspaceEnvPatch, WorkspaceEnvSubscriber, FileToolActionRequest, ReadFileToolInput, SearchToolActionRequest } from "@downcity/type/workspace";
import { SshConnection } from "./SshConnection.js";
import { SshFileSystem } from "./SshFileSystem.js";
import { initialize_ssh_dependencies } from "./SshInitialization.js";
import { read_ssh_media } from "./SshMedia.js";
import { SshShell } from "./SshShell.js";
import type { SshRequestOptions, SshWorkspaceOptions, SshValidation } from "./types/Ssh.js";
const range_schema = z.discriminatedUnion("type", [z.strictObject({ type: z.literal("lines"), offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(2000).optional(), expected_version: z.string().optional() }), z.strictObject({ type: z.literal("bytes"), offset: z.number().int().nonnegative(), expected_version: z.string().optional() })]);
const file_schemas = {
    read: z.strictObject({ file_path: z.string().min(1), range: range_schema.optional() }),
    write: z.strictObject({ file_path: z.string().min(1), content: z.string().max(1024 * 1024), overwrite: z.boolean().optional() }),
    edit: z.strictObject({ file_path: z.string().min(1), edits: z.array(z.strictObject({ old_text: z.string().min(1).max(10000), new_text: z.string().max(50000) })).min(1).max(10), expected_sha256: z.string().regex(/^[a-fA-F0-9]{64}$/u).optional() }),
};
const search_schemas = {
    grep: z.strictObject({ query: z.string().min(1), path: z.string().optional(), glob: z.array(z.string()).max(20).optional(), case_sensitive: z.boolean().optional(), literal: z.boolean().optional(), max_results: z.number().int().min(1).max(2000).optional() }),
    find: z.strictObject({ pattern: z.string().min(1), path: z.string().optional(), max_results: z.number().int().min(1).max(2000).optional() }),
};
/** 系统 OpenSSH 项目能力；生命周期由 City 管理。 */
export class SshWorkspace implements WorkspaceRuntime {
    readonly id: string;
    readonly name: string;
    /** 标记为远端逻辑地址，避免宿主把远程路径当成本机文件。 */
    get path(): string { return `ssh://${encodeURIComponent(this.connection.host)}${this.files.root_path.split("/").map(encodeURIComponent).join("/")}`; }
    readonly files: SshFileSystem;
    readonly shell: SshShell;
    readonly tools: WorkspaceTools;
    private readonly connection: SshConnection;
    private env: Record<string, string> = {};
    private readonly subscribers = new Set<WorkspaceEnvSubscriber>();
    private validation?: Promise<void>;
    private canonical_root_required: boolean;
    constructor(options: SshWorkspaceOptions) {
        this.canonical_root_required = options.canonical_root === true;
        this.id = options.id;
        if (!this.id.trim())
            throw new Error("Workspace id is required");
        this.connection = new SshConnection(options.host);
        this.files = new SshFileSystem(this.connection, options.root_path);
        this.name = options.name || path.posix.basename(this.files.root_path) || options.host;
        this.shell = new SshShell(this.connection, this.files);
        this.tools = {};
        for (const action of ["read", "write", "edit"] as const) {
            this.tools[action] = define_agent_tool({ description: `${action} a file on the SSH Workspace. Remote files are rooted; text reads return at most 64 KiB.`, input_schema: file_schemas[action], execute: async (input, context) => {
                    const parsed = file_schemas[action].parse(input);
                    if (action === "read") {
                        const attachment = await context.read_attachment?.(parsed as ReadFileToolInput);
                        if (attachment)
                            return { output: attachment, messages: [] };
                    }
                    await this.ready();
                    const effects: ToolEffect[] = [];
                    const result = await this.files.run_file_action({ action, input: parsed } as FileToolActionRequest, { on_file_mutation: (mutation) => { effects.push(create_workspace_file_mutation_effect(mutation)); } }, context.abort_signal);
                    if (action === "read" && result.success && "type" in result && result.type === "binary")
                        return await read_ssh_media(this.files, result, context);
                    return { output: result, effects, messages: [] };
                } });
        }
        for (const action of ["grep", "find"] as const) {
            this.tools[action] = define_agent_tool({ description: `${action} remote project files using ripgrep; respects ignore files and does not follow symbolic links.`, input_schema: search_schemas[action], execute: async (input, context) => {
                    await this.ready();
                    return await this.files.run_search_action({ action, input: search_schemas[action].parse(input), abort_signal: context.abort_signal } as SearchToolActionRequest);
                } });
        }
        // Shell 工具在首次调用前装载远程环境，后续执行不注入 Desktop HOME 或全局凭据。
        for (const tool of Object.values(this.shell.tools)) {
            const execute = tool.execute;
            if (execute)
                Object.assign(tool, { execute: async (input: unknown, context: Parameters<typeof execute>[1]) => { await this.ready(); return await execute(input, context); } });
        }
    }
    /** 验证目录并加载远程环境；仅显式登记操作可请求主机确认。 */
    async validate(options: SshRequestOptions = {}): Promise<Pick<SshValidation, "root_path" | "platform">> {
        const result = await this.files.rpc<SshValidation>("validate", { resolve_root: !this.canonical_root_required }, options);
        this.files.use_canonical_root(result.root_path);
        this.canonical_root_required = true;
        this.set_env(result.env);
        this.validation = Promise.resolve();
        return { root_path: result.root_path, platform: result.platform };
    }
    /** 显式安装缺少的依赖，安装后用正常 Workspace 协议验证目录和环境。 */
    async initialize(options: SshRequestOptions = {}): Promise<Pick<SshValidation, "root_path" | "platform">> {
        const root_path = await initialize_ssh_dependencies(this.connection, this.files.root_path, this.canonical_root_required, options);
        this.files.use_canonical_root(root_path);
        this.canonical_root_required = true;
        return await this.validate({ signal: options.signal });
    }
    private async ready(): Promise<void> {
        if (!this.validation) {
            const pending = this.validate().then(() => { });
            this.validation = pending;
            pending.catch(() => { if (this.validation === pending)
                this.validation = undefined; });
        }
        await this.validation;
    }
    get_env(): Record<string, string> { return { ...this.env }; }
    set_env(next: WorkspaceEnvPatch): void { this.env = {}; this.patch_env(next); }
    patch_env(patch: WorkspaceEnvPatch): void {
        for (const [key, value] of Object.entries(patch)) {
            if (value == null)
                delete this.env[key];
            else
                this.env[key] = value;
        }
        this.shell.set_env(this.env);
        const snapshot = Object.freeze(this.get_env());
        for (const subscriber of this.subscribers)
            subscriber(snapshot);
    }
    subscribe_env(subscriber: WorkspaceEnvSubscriber): () => void { this.subscribers.add(subscriber); return () => this.subscribers.delete(subscriber); }
    async dispose(): Promise<void> { await this.shell.dispose(); await this.connection.dispose(); this.subscribers.clear(); }
}
