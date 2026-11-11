/**
 * 登记前的远端目录准备。仅依赖 POSIX Shell，支持没有 Python 的新主机。
 * 主机确认在只读检查阶段完成；目录创建单独提交，失败与断线均不自动重放。
 */
import type { SshConnection } from "./SshConnection.js";
import { ssh_runtime_command } from "./SshInitialization.js";
import type { SshRequestOptions } from "./types/Ssh.js";
import type { SshDirectoryState } from "./types/SshDirectory.js";

const inspect_directory = `
fail() { printf '%s\\n' "$*" >&2; exit 1; }
case "$1" in /*) ;; *) fail 'Expected an absolute remote directory' ;; esac
# 从最近的已有父级开始检查，避免把不可访问的目录误判为不存在。
target=$1
remainder=
while :; do
    if [ -d "$target" ]; then
        cd -P "$target" 2>/dev/null && [ -r . ] && [ -x . ] || fail 'Remote directory is not readable and accessible'
        break
    fi
    if [ -e "$target" ] || [ -L "$target" ]; then fail 'Remote path is not a directory'; fi
    component=\${target##*/}
    remainder=/$component$remainder
    target=\${target%/*}
    [ -n "$target" ] || target=/
done
if [ -z "$remainder" ]; then
    printf 'existing\\0%s\\0' "$PWD"
else
    printf 'missing\\0%s\\0' "\${PWD%/}$remainder"
fi
`;

/** 只读确认目录状态；明确 create 时才创建缺失的目录与父目录。 */
export async function prepare_ssh_directory(
    connection: SshConnection,
    root_path: string,
    create: boolean,
    options: SshRequestOptions = {},
    exclusive = false,
): Promise<SshDirectoryState> {
    const response = await connection.request(ssh_runtime_command(inspect_directory, root_path), {
        discover_host: options.discover_host,
        confirmed_prompt: options.confirmed_prompt,
        signal: options.signal,
        max_bytes: 64 * 1024,
    });
    const [status, directory_path, end, ...extra] = response.split("\0");
    if (!["existing", "missing"].includes(status) || !directory_path?.startsWith("/") || end !== "" || extra.length)
        throw new Error("SSH returned an invalid directory status; ensure startup scripts do not print to stdout");
    if (status === "existing" && create && exclusive) throw new Error("A folder with this name already exists");
    if (status === "existing" || !create) return { path: directory_path, exists: status === "existing" };
    const created = await connection.request(ssh_runtime_command(String.raw`
if [ "$2" = exclusive ]; then mkdir -- "$1" || exit 1; else mkdir -p -- "$1" || exit 1; fi
cd -P "$1" && [ -r . ] && [ -x . ] || { printf '%s\n' 'Created directory is not readable and accessible' >&2; exit 1; }
printf '%s\0' "$PWD"
`, directory_path, exclusive ? "exclusive" : "parents"), { mutation: true, signal: options.signal, max_bytes: 64 * 1024 });
    if (!created.startsWith("/") || created.indexOf("\0") !== created.length - 1)
        throw new Error("Directory creation response was invalid; inspect the remote directory before retrying");
    return { path: created.slice(0, -1), exists: true };
}
