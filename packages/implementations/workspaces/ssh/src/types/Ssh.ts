/** SSH 连接、文件 RPC 和交互进程的内部类型；不保存认证秘密。 */
import type { ChildProcessWithoutNullStreams } from "node:child_process";
/** SSH Workspace 的稳定连接参数。 */
export interface SshWorkspaceOptions {
    /** City 分配的稳定 Workspace ID。 */
    id: string;
    /** 展示名称；省略时取远程目录名。 */
    name?: string;
    /** 系统 SSH Host 别名或 user@host，禁止选项和空白字符。 */
    host: string;
    /** 从 Registry 恢复的根已经规范化，禁止验证时通过新符号链接重定向。 */
    canonical_root?: boolean;
    /** 远程 POSIX 绝对根目录。 */
    root_path: string;
}
/** 未知主机的待确认身份，由 OpenSSH 自己生成。 */
export interface SshHostChallenge {
    /** 用户提交的连接目标。 */
    host: string;
    /** 包含算法、地址及 SHA256 指纹的 OpenSSH 原始提示。 */
    prompt: string;
}
/** 一次远程请求的执行约束。 */
export interface SshRequestOptions {
    /** stdin 字节，作为数据传输，不能拼入命令。 */
    input?: string | Buffer;
    /** 调用取消信号。 */
    signal?: AbortSignal;
    /** 总超时毫秒，默认三十秒。 */
    timeout_ms?: number;
    /** 输出字节上限，默认九十 MiB。 */
    max_bytes?: number;
    /** 请求可能修改文件或执行命令，断线后结果可能未知。 */
    mutation?: boolean;
    /** 仅登记验证阶段允许展示未知主机确认。 */
    discover_host?: boolean;
    /** 用户已明确确认的原始主机提示；只匹配完全相同的提示。 */
    confirmed_prompt?: string;
}
/** SSH Shell 交互进程；仅保留有界输出。 */
export interface SshProcessSession {
    /** 宿主内唯一的交互会话标识。 */
    id: string;
    /** 发起 Session 的作用域；没有 Session 的 SDK 执行不暴露给工具会话。 */
    owner_context_id?: string;
    /** 已验证不含私密引用的命令源码。 */
    cmd: string;
    /** 可信工具上下文登记的完整 Session 身份。 */
    owner?: import("@downcity/type/shell").WorkspaceActiveShell["owner"];
    /** 本地监督器开始执行的毫秒时间戳。 */
    started_at: number;
    /** 当前 OpenSSH 子进程。 */
    process: ChildProcessWithoutNullStreams;
    /** 有界输出缓冲。 */
    output: string;
    /** 输出是否已经丢弃过前缀。 */
    truncated: boolean;
    /** 进程退出码；运行中为 null。 */
    exit_code: number | null;
    /** 传输错误或退出原因。 */
    error?: string;
    /** 进程退出时释放的清理函数。 */
    cleanup: () => void;
}
/** 远程文件元信息，目录列表也携带这些字段。 */
export interface SshFileMetadata {
    /** 文件字节大小。 */
    size: number;
    /** 远程修改时间的 Unix 毫秒值。 */
    modified_at: number;
    /** 是否为普通目录。 */
    is_directory: boolean;
    /** 是否为普通文件。 */
    is_file: boolean;
}
/** 临时远端 JSON RPC 的响应；错误不表示可以重放写入。 */
export interface SshRpcResponse<T> {
    /** 远端程序是否完整执行成功。 */
    ok: boolean;
    /** 成功结果，由具体操作定义。 */
    result: T;
    /** 可解析的文件错误码。 */
    code?: string;
    /** 面向用户的失败原因。 */
    message?: string;
}
/** 验证得到的真实远端根与环境；不会保存到 City 凭据存储。 */
export interface SshValidation {
    /** 远程 realpath 后的 POSIX 根目录。 */
    root_path: string;
    /** 远程操作系统；只支持 linux/darwin。 */
    platform: string;
    /** 远程登录用户的必要环境变量。 */
    env: Record<string, string>;
}
/** 启动远端监督进程的命令参数。 */
export interface SshCommandOptions {
    /** 用户命令源码，通过 JSON 编码独立于监督器源码传输。 */
    cmd: string;
    /** 受 Workspace 约束的初始工作目录。 */
    workdir?: string;
    /** 可选的远程解释器路径。 */
    shell?: string;
    /** 是否使用 login shell 语义。 */
    login?: boolean;
    /** 是否在远端分配 PTY。 */
    terminal?: boolean;
    /** 远端 PTY 初始列数。 */
    cols?: number;
    /** 远端 PTY 初始行数。 */
    rows?: number;
    /** 可信 SDK 调用明确提供的远端变量，合并到远程登录环境。 */
    env?: Readonly<Record<string, string>>;
    /** 兼容 Shell 动作的目标字段；host 目标被拒绝。 */
    target?: string;
}
/** 需要当前 Session 保存的显式媒体消息。 */
export interface SshMediaMessage {
    /** 作为可信工具附加输入投影到模型。 */
    role: "user";
    /** 包含有界 Data URL 快照的规范消息内容。 */
    parts: import("@downcity/type").SessionUserContent[];
}
/** 显式媒体读取结果与需持久化的消息。 */
export interface SshMediaResult {
    /** 有界的结构化文件结果。 */
    output: import("@downcity/type/workspace").ReadFileToolSuccess;
    /** 由 Session 保存到本机附件目录的内容。 */
    messages: SshMediaMessage[];
}
