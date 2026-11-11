/**
 * SSH Workspace 的 POSIX Shell 入口和内置依赖安装脚本。
 * 安装不读取项目脚本；只在显式初始化时调用已有的远端包管理器。
 */
import { SshConnection, quote_posix } from "./SshConnection.js";
import type { SshRequestOptions } from "./types/Ssh.js";

/** 给所有 SSH Workspace 能力使用相同的非交互 PATH，包含标准 Homebrew 前缀。 */
export function ssh_runtime_command(script: string, ...args: string[]): string {
    const runtime_path = 'for prefix in /usr/local /opt/homebrew; do if [ -x "$prefix/bin/brew" ]; then PATH="$prefix/bin:$PATH"; fi; done; export PATH';
    return `exec /bin/sh -c ${quote_posix(`${runtime_path}\n${script}`)} downcity${args.map((arg) => ` ${quote_posix(arg)}`).join("")}`;
}

const check_target = String.raw`
fail() { printf '%s\n' "$*" >&2; exit 1; }
case "$1" in /*) ;; *) fail 'SSH Workspace requires an absolute remote directory' ;; esac
cd -P "$1" && [ -r . ] && [ -x . ] || fail 'Remote Workspace directory is not readable and accessible'
if [ "$2" = canonical ] && [ "$PWD" != "$1" ]; then
    fail 'Registered SSH directory now resolves to a different path; verify the directory before initializing'
fi
canonical_path=$PWD
# 包管理器不从项目目录查找程序或配置。
cd / || fail 'Cannot enter the remote filesystem root'
platform=$(uname -s) || fail 'Cannot detect the remote operating system'
case "$platform" in Linux|Darwin) ;; *) fail 'Only Linux and macOS SSH hosts are supported' ;; esac
`;

const install_dependencies = String.raw`
python_ready() { command -v python3 >/dev/null 2>&1 && python3 -I -S -c 'import sys; sys.exit(sys.version_info < (3, 8))' >/dev/null 2>&1; }
rg_ready() { command -v rg >/dev/null 2>&1; }
ps_ready() { command -v ps >/dev/null 2>&1; }
if python_ready && rg_ready && ps_ready; then exit 0; fi

set --
if [ "$platform" = Darwin ]; then
    ps_ready || fail 'POSIX ps is missing; restore the macOS system ps command before retrying'
    command -v brew >/dev/null 2>&1 || fail 'Homebrew is required to initialize missing SSH Workspace dependencies on macOS; install Homebrew or provide Python 3.8+ and ripgrep manually'
    python_ready || set -- "$@" python
    rg_ready || set -- "$@" ripgrep
    manager=brew
else
    python_ready || set -- "$@" python3
    rg_ready || set -- "$@" ripgrep
    ps_ready || set -- "$@" procps
    if command -v apt-get >/dev/null 2>&1; then
        manager=apt-get
    elif command -v dnf >/dev/null 2>&1; then
        manager=dnf
    elif command -v apk >/dev/null 2>&1; then
        manager=apk
    else
        fail 'No supported package manager (apt-get, dnf, apk) found; provide Python 3.8+, ripgrep and POSIX ps manually'
    fi
fi

# 无交互执行：既不读取 sudo 密码，也不在缺少权限时等待输入。
if [ "$platform" = Linux ] && [ "$(id -u)" != 0 ]; then
    command -v sudo >/dev/null 2>&1 || fail 'Installing SSH Workspace dependencies requires root or non-interactive sudo; install the missing packages as an administrator'
    run_manager() { sudo -n -- "$manager" "$@"; }
else
    run_manager() { "$manager" "$@"; }
fi

case "$manager" in
    brew) run_manager install "$@" ;;
    apt-get) run_manager update && run_manager -o Dpkg::Use-Pty=0 install -y "$@" ;;
    dnf) run_manager install -y "$@" ;;
    apk) run_manager add "$@" ;;
esac 1>&2 || fail "Installing SSH Workspace dependencies with $manager failed ($*). See the package manager output above."

python_ready || fail 'Python 3.8+ is still unavailable on the non-interactive SSH PATH after installation'
rg_ready || fail 'ripgrep (rg) is still unavailable on the non-interactive SSH PATH after installation'
ps_ready || fail 'POSIX ps is still unavailable on the non-interactive SSH PATH after installation'
`;

/** 检查主机和目录不依赖 Python；仅通过验证后的严格 SSH 连接运行有副作用的命令。 */
export async function initialize_ssh_dependencies(
    connection: SshConnection,
    root_path: string,
    canonical_root: boolean,
    options: SshRequestOptions,
): Promise<string> {
    const root_mode = canonical_root ? "canonical" : "resolve";
    const probe = `${check_target}\nprintf '%s\\0' "$canonical_path"`;
    const response = await connection.request(ssh_runtime_command(probe, root_path, root_mode), {
        discover_host: options.discover_host,
        confirmed_prompt: options.confirmed_prompt,
        signal: options.signal,
        max_bytes: 4096,
    });
    if (!response.startsWith("/") || response.indexOf("\0") !== response.length - 1)
        throw new Error("SSH returned an invalid directory response; ensure startup scripts do not print to stdout");
    const verified_path = response.slice(0, -1);
    await connection.request(ssh_runtime_command(`${check_target}\n${install_dependencies}`, verified_path, "canonical"), {
        mutation: true,
        signal: options.signal,
        timeout_ms: 5 * 60_000,
        max_bytes: 4096,
    });
    return verified_path;
}
