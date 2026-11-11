/** SSH rooted 文件能力；所有文件字节和路径均留在远端处理，RPC 无自动重试。 */
import path from "node:path";
import type { FileSystem, WorkspaceDirectoryEntry, FileToolActionRequest, FileToolActionResult, SearchToolActionRequest, SearchToolActionResult, WorkspaceFileMutationObserver } from "@downcity/type/workspace";
import type { SshConnection } from "./SshConnection.js";
import { ssh_runtime_command } from "./SshInitialization.js";
import { remote_program } from "./RemoteProgram.js";
import type { SshRequestOptions, SshFileMetadata, SshRpcResponse } from "./types/Ssh.js";
/** 具有远端错误码的文件失败。 */
export class SshFileError extends Error {
    constructor(readonly code: string, message: string) { super(message); }
}
/** 规范化远程 POSIX 绝对根目录，不调用宿主 realpath/resolve。 */
export function normalize_remote_root(value: string): string {
    if (!value.startsWith("/") || value.includes("\0"))
        throw new Error("Remote directory must be an absolute POSIX path");
    return path.posix.normalize(value).replace(/\/$/u, "") || "/";
}
/** 每次 RPC 使用远端标准输入 JSON，无远程缓存或工作副本。 */
export class SshFileSystem implements FileSystem {
    private canonical_root: string;
    get root_path(): string { return this.canonical_root; }
    /** 连接验证后固定远端规范根；后续请求拒绝该根被替换成 symlink。 */
    use_canonical_root(root_path: string): void { this.canonical_root = normalize_remote_root(root_path); }
    private readonly locks = new Map<string, Promise<void>>();
    constructor(readonly connection: SshConnection, root_path: string) { this.canonical_root = normalize_remote_root(root_path); }
    resolve_path(...segments: string[]): string {
        let result = this.root_path;
        for (let segment of segments) {
            if (segment.startsWith("ssh://")) {
                const location = new URL(segment);
                if (decodeURIComponent(location.hostname) !== this.connection.host)
                    throw new Error("SSH path targets another host");
                segment = location.pathname.split("/").map(decodeURIComponent).join("/");
            }
            result = path.posix.resolve(result, segment);
        }
        if (result !== this.root_path && !result.startsWith(this.root_path === "/" ? "/" : `${this.root_path}/`))
            throw new Error("Path escapes SSH Workspace");
        return result;
    }
    /** 远端需要预装 Python；缺失时保留 SSH 返回的明确错误。 */
    async rpc<T>(operation: string, args: Record<string, unknown> = {}, options: SshRequestOptions = {}): Promise<T> {
        const command = ssh_runtime_command(`command -v python3 >/dev/null 2>&1 || { printf '%s\\n' 'SSH Workspace needs Python 3.8+ on the remote host; run SSH Workspace dependency initialization' >&2; exit 127; }; exec python3 -c "$1"`, remote_program);
        const raw = await this.connection.request(command, { ...options, input: JSON.stringify({ root: this.root_path, operation, arguments: args }) });
        let response: SshRpcResponse<T>;
        try { response = JSON.parse(raw) as SshRpcResponse<T>; }
        catch { throw new Error(options.mutation ? "SSH mutation response was invalid; result may be unknown. Inspect remote state before retrying. It was not replayed." : "SSH returned an invalid file response; ensure remote startup scripts do not print to stdout for non-interactive commands"); }
        if (!response.ok)
            throw new SshFileError(response.code || "internal_error", response.message || "Remote operation failed");
        return response.result;
    }
    async stat(file_path: string): Promise<SshFileMetadata> { return await this.rpc("stat", { path: this.resolve_path(file_path) }); }
    async path_exists(file_path: string): Promise<boolean> {
        try {
            await this.stat(file_path);
            return true;
        }
        catch (error) {
            if (error instanceof SshFileError && error.code === "file_not_found")
                return false;
            throw error;
        }
    }
    async read_file(file_path: string): Promise<Buffer> { return Buffer.from(await this.rpc<string>("read", { path: this.resolve_path(file_path) }), "base64"); }
    async file_size(file_path: string): Promise<number> { return (await this.stat(file_path)).size; }
    async ensure_directory(directory_path: string): Promise<void> { await this.rpc("mkdir", { path: this.resolve_path(directory_path) }, { mutation: true }); }
    async remove_path(target_path: string): Promise<void> { await this.rpc("remove", { path: this.resolve_path(target_path) }, { mutation: true }); }
    async move_path(source_path: string, target_path: string): Promise<void> { await this.rpc("move", { path: this.resolve_path(source_path), target: this.resolve_path(target_path) }, { mutation: true }); }
    async read_directory(directory_path: string): Promise<(WorkspaceDirectoryEntry & SshFileMetadata)[]> { return await this.rpc("list", { path: this.resolve_path(directory_path) }); }
    async write_file_atomically(file_path: string, content: string | Buffer): Promise<void> { await this.rpc("write", { path: this.resolve_path(file_path), content: Buffer.from(content).toString("base64") }, { mutation: true }); }
    async append_file(file_path: string, content: string | Buffer): Promise<void> { await this.rpc("append", { path: this.resolve_path(file_path), content: Buffer.from(content).toString("base64") }, { mutation: true }); }
    async with_file_lock<T>(lock_path: string, action: () => Promise<T>): Promise<T> {
        const key = this.resolve_path(lock_path);
        const previous = this.locks.get(key) || Promise.resolve();
        let release = () => { };
        const pending = new Promise<void>((resolve) => { release = resolve; });
        const queued = previous.then(() => pending);
        this.locks.set(key, queued);
        await previous;
        try {
            return await action();
        }
        finally {
            release();
            if (this.locks.get(key) === queued)
                this.locks.delete(key);
        }
    }
    async run_file_action(request: FileToolActionRequest, observer?: WorkspaceFileMutationObserver, abort_signal?: AbortSignal): Promise<FileToolActionResult> {
        try {
            const result = await this.rpc<FileToolActionResult>("file_action", { ...request, input: { ...request.input, file_path: this.resolve_path(request.input.file_path) } }, { signal: abort_signal, mutation: request.action !== "read" });
            if (result.success && request.action !== "read" && "sha256" in result) {
                try {
                    observer?.on_file_mutation({ file_path: result.file_path, before: { exists: request.action === "edit" || ("overwritten" in result && result.overwritten), ...("previous_sha256" in result ? { sha256: result.previous_sha256 } : {}) }, after: { exists: true, sha256: result.sha256, ...(request.action === "write" ? { content: request.input.content } : {}) } });
                }
                catch { /* 已提交，不以观察失败回滚真实结果。 */ }
            }
            return result;
        }
        catch (error) {
            if (!(error instanceof SshFileError))
                throw error;
            return { success: false, error_code: error.code as "internal_error", message: error.message };
        }
    }
    async run_search_action(request: SearchToolActionRequest): Promise<SearchToolActionResult> {
        try {
            return await this.rpc("search_action", { action: request.action, input: { ...request.input, path: this.resolve_path(request.input.path || ".") } }, { signal: request.abort_signal });
        }
        catch (error) {
            if (!(error instanceof SshFileError))
                throw error;
            return { success: false, error_code: error.code === "file_not_found" ? "rg_unavailable" : "search_failed", message: error.message };
        }
    }
}
