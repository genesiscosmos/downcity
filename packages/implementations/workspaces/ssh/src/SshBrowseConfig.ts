/**
 * 为只读浏览生成临时 OpenSSH 配置快照，不执行 ssh -G 或任何配置命令。
 * 保留系统 SSH 对 Host/Match、密钥及 ProxyJump 的解释；Include 改为有界静态副本。
 * LocalCommand/RemoteCommand/KnownHostsCommand 被禁用；exec 条件和自定义 ProxyCommand
 * 无法静态解释，明确拒绝。ProxyJump 子进程由 OpenSSH 继承同一 -F 配置。
 */
import { constants } from "node:fs";
import { open, opendir, realpath, mkdtemp, writeFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

/** 配置参数拆分，支持 OpenSSH 引号、转义和参数间注释；不做变量或命令展开。 */
function split_arguments(value: string): string[] {
    const result: string[] = [];
    let token = "";
    let quote = "";
    let started = false;
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index]!;
        if (character === "\\" && ["\\", "'", '"', ...(!quote ? [" "] : [])].includes(value[index + 1] || "")) {
            token += value[++index];
            started = true;
        } else if (!quote && (character === "'" || character === '"')) {
            quote = character;
            started = true;
        } else if (quote === character) quote = "";
        else if (!quote && !started && character === "#") break;
        else if (!quote && /[ \t]/u.test(character)) {
            if (started) result.push(token);
            token = "";
            started = false;
        } else { token += character; started = true; }
    }
    if (quote) throw new Error("Unclosed SSH config quote");
    if (started) result.push(token);
    return result;
}

/** 缺失的配置与未匹配的 Include 不属于读取失败。 */
function is_missing(error: unknown): boolean {
    return !!error && typeof error === "object" && "code" in error && ["ENOENT", "ENOTDIR"].includes(String(error.code));
}

/**
 * 返回临时配置和清理函数；测试可提供隔离配置根，Renderer 不接受这些本机路径。
 * 完成快照后才允许 OpenSSH 启动，读取期间取消也会清理所有临时文件。
 */
export async function create_ssh_browse_config(signal: AbortSignal, home_path = homedir(), system_path = "/etc/ssh/ssh_config"): Promise<{
    /** 交给系统 OpenSSH -F 的临时绝对配置路径。 */
    config_path: string;
    /** 关闭连接后删除快照及其所在临时目录。 */
    dispose(): Promise<void>;
}> {
    const temporary_path = await mkdtemp(path.join(tmpdir(), "downcity-ssh-browse-"));
    const dispose = async () => { await rm(temporary_path, { recursive: true, force: true }); };
    const active = new Set<string>();
    let file_count = 0;
    let entry_count = 0;
    let total_bytes = 0;
    /** 有界普通 glob，不使用可能递归扫描整台宿主的 glob 引擎。 */
    async function expand(pattern: string): Promise<string[]> {
        let candidates = [path.parse(pattern).root];
        for (const component of pattern.slice(candidates[0]!.length).split(path.sep).filter(Boolean)) {
            const next: string[] = [];
            for (const directory of candidates) {
                signal.throwIfAborted();
                if (!/[?*[]/u.test(component)) { next.push(path.join(directory, component)); continue; }
                try {
                    for await (const entry of await opendir(directory)) {
                        if (++entry_count > 10000) throw new Error("SSH Include scan limit exceeded");
                        if (entry.name.startsWith(".") && !component.startsWith(".")) continue;
                        if (path.matchesGlob(entry.name, component)) next.push(path.join(directory, entry.name));
                    }
                } catch (error) { if (!is_missing(error)) throw error; }
            }
            candidates = next.sort();
        }
        return candidates;
    }
    /** 保留独立 Include 文件，使 OpenSSH 自己恢复条件作用域。 */
    async function copy_config(file_path: string, include_root: string, depth = 0): Promise<string | null> {
        signal.throwIfAborted();
        if (depth > 16 || ++file_count > 128) throw new Error("SSH Include recursion limit exceeded");
        let canonical: string;
        try { canonical = await realpath(file_path); }
        catch (error) { if (is_missing(error)) return null; throw error; }
        if (active.has(canonical)) throw new Error("Recursive SSH Include");
        active.add(canonical);
        try {
            const handle = await open(canonical, constants.O_RDONLY | constants.O_NONBLOCK);
            let content: string;
            try {
                const info = await handle.stat();
                if (!info.isFile() || info.size > 1024 * 1024) throw new Error("Invalid SSH config file");
                const buffer = Buffer.alloc(1024 * 1024 + 1);
                let size = 0;
                while (size < buffer.length) {
                    signal.throwIfAborted();
                    const result = await handle.read(buffer, size, buffer.length - size, null);
                    if (!result.bytesRead) break;
                    size += result.bytesRead;
                }
                total_bytes += size;
                if (size > 1024 * 1024 || total_bytes > 4 * 1024 * 1024) throw new Error("SSH config size limit exceeded");
                content = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
            } finally { await handle.close(); }
            const output: string[] = [];
            for (const line of content.split(/\r?\n/u)) {
                signal.throwIfAborted();
                const match = /^\s*([^\s=#]+)\s*(?:=\s*)?(.*)$/u.exec(line);
                const keyword = match?.[1]?.toLowerCase();
                if (!keyword) { output.push(line); continue; }
                if (["localcommand", "remotecommand", "knownhostscommand"].includes(keyword)) continue;
                if (keyword === "match" && split_arguments(match![2]!).some((value) => /^!?exec(?:=|$)/iu.test(value))) {
                    throw new Error("Read-only SSH browsing does not support Match exec in SSH config");
                }
                if (keyword === "proxycommand" && split_arguments(match![2]!)[0]?.toLowerCase() !== "none") {
                    throw new Error("Read-only SSH browsing requires ProxyJump instead of ProxyCommand");
                }
                if (keyword !== "include") { output.push(line); continue; }
                const includes = split_arguments(match![2]!);
                if (!includes.length) throw new Error("Missing SSH Include argument");
                for (const value of includes) {
                    if (/[$%\\{}]/u.test(value) || value.includes("[[:") || (value.startsWith("~") && !value.startsWith("~/"))) {
                        throw new Error("Read-only SSH browsing requires static SSH Include paths");
                    }
                    const pattern = value.startsWith("~/") ? path.join(home_path, value.slice(2)) : path.resolve(include_root, value);
                    for (const included of await expand(pattern)) {
                        const snapshot = await copy_config(included, include_root, depth + 1);
                        if (snapshot) output.push(`Include "${snapshot}"`);
                    }
                }
            }
            const destination = path.join(temporary_path, `${file_count}-${Math.random().toString(36).slice(2)}.conf`);
            await writeFile(destination, output.join("\n") + "\n", { mode: 0o600 });
            return destination;
        } finally { active.delete(canonical); }
    }
    try {
        const user_config = await copy_config(path.join(home_path, ".ssh", "config"), path.join(home_path, ".ssh"));
        const system_config = await copy_config(system_path, path.dirname(system_path));
        signal.throwIfAborted();
        const config_path = path.join(temporary_path, "config");
        await writeFile(config_path, [user_config, system_config].filter(Boolean).map((value) => `Host *\nInclude "${value}"\n`).join(""), { mode: 0o600 });
        return { config_path, dispose };
    } catch (error) { await dispose(); throw error; }
}
