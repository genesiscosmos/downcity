/**
 * 登记前的目录连接；支持只读浏览和用户显式请求的目录创建，不登记 Workspace。
 * 每次浏览显式创建并释放连接，取消、失败及未知主机拒绝均清理子进程和配置快照。
 */
import { SshConnection } from "./SshConnection.js";
import { ssh_runtime_command } from "./SshInitialization.js";
import { normalize_remote_root, SshFileError } from "./SshFileSystem.js";
import { create_ssh_browse_config } from "./SshBrowseConfig.js";
import { remote_directory_program } from "./RemoteDirectoryProgram.js";
import { prepare_ssh_directory } from "./SshDirectorySetup.js";
import type { SshRequestOptions, SshRpcResponse } from "./types/Ssh.js";
import type { SshDirectoryPage, SshDirectoryQuery, SshDirectoryPreparation, SshDirectoryState } from "./types/SshDirectory.js";

/** 一个显式浏览请求的短期资源；调用者必须在 finally 中 dispose。 */
export class SshDirectoryBrowser {
    private constructor(private readonly connection: SshConnection, private readonly cleanup: () => Promise<void>) {}
    /** 快照阶段完全只读，实际网络只在 read_directory 被明确调用后发生。 */
    static async create(host: string, signal: AbortSignal): Promise<SshDirectoryBrowser> {
        const config = await create_ssh_browse_config(signal);
        try { return new SshDirectoryBrowser(new SshConnection(host, config.config_path), config.dispose); }
        catch (error) { await config.dispose(); throw error; }
    }
    /** 在远端取得 Home 或规范化指定目录；无自动重试，主机确认由可信 UI 负责。 */
    async read_directory(query: SshDirectoryQuery, options: SshRequestOptions): Promise<SshDirectoryPage> {
        if (query.path !== undefined) normalize_remote_root(query.path);
        if ((query.path?.length ?? 0) > 16384 || (query.cursor?.length ?? 0) > 4096) throw new Error("Remote directory query is too large");
        const command = ssh_runtime_command(`command -v python3 >/dev/null 2>&1 || { printf '%s\\n' 'SSH directory browsing needs Python 3.8+; enter the remote path manually to initialize dependencies' >&2; exit 127; }; exec python3 -c "$1"`, remote_directory_program);
        const raw = await this.connection.request(command, { ...options, input: JSON.stringify(query), max_bytes: 64 * 1024 });
        let response: SshRpcResponse<SshDirectoryPage>;
        try { response = JSON.parse(raw) as SshRpcResponse<SshDirectoryPage>; }
        catch { throw new Error("SSH returned an invalid directory response; ensure non-interactive startup scripts do not print to stdout"); }
        if (!response.ok) throw new SshFileError(response.code || "directory_error", response.message || "Remote directory could not be read");
        const result = response.result;
        if (!result || typeof result.path !== "string" || normalize_remote_root(result.path) !== result.path
            || !(result.parent_path === null || typeof result.parent_path === "string")
            || !(result.next_cursor === null || typeof result.next_cursor === "string")
            || !Array.isArray(result.directories) || result.directories.length > 100
            || result.directories.some((entry) => !entry || typeof entry.name !== "string" || !entry.name || entry.name.includes("/") || entry.name.includes("\0") || [".", ".."].includes(entry.name)
                || entry.path !== `${result.path === "/" ? "" : result.path}/${entry.name}` || typeof entry.is_symlink !== "boolean")) {
            throw new Error("SSH returned an invalid directory page");
        }
        return result;
    }
    /** 不依赖 Python 的检查/创建；名称只能是当前父级内的一个目录。 */
    async prepare_directory(query: SshDirectoryPreparation, options: SshRequestOptions): Promise<SshDirectoryState> {
        let target = normalize_remote_root(query.path);
        if (target.length > 16384) throw new Error("Remote directory path is too large");
        if (query.name !== undefined) {
            if (!query.name.trim() || Buffer.byteLength(query.name) > 255 || /[/\0]/u.test(query.name) || [".", ".."].includes(query.name)) throw new Error("Expected one folder name");
            const parent = await prepare_ssh_directory(this.connection, target, false, options);
            if (!parent.exists) throw new Error("Parent directory does not exist");
            target = `${parent.path === "/" ? "" : parent.path}/${query.name}`;
        }
        return await prepare_ssh_directory(this.connection, target, query.create === true, options, query.name !== undefined);
    }
    /** 先关闭通道，再删除包括跳板所需配置在内的快照。 */
    async dispose(): Promise<void> { try { await this.connection.dispose(); } finally { await this.cleanup(); } }
}
