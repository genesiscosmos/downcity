/** 登记前的远程目录浏览与准备协议；所有路径均为远端 POSIX 路径。 */
export interface SshDirectoryEntry {
    /** 远端目录原始名称，保留空白、换行、引号和反斜杠。 */
    name: string;
    /** 用于下次浏览的远端绝对路径；符号链接进入后返回真实路径。 */
    path: string;
    /** 此条目是否为指向目录的符号链接。 */
    is_symlink: boolean;
}
/** 一页已排序的目录条目和规范位置。 */
export interface SshDirectoryPage {
    /** 当前目录经过远端 realpath 后的绝对路径，可直接交给登记验证。 */
    path: string;
    /** 规范目录的父级；根目录为 null。 */
    parent_path: string | null;
    /** 本页可进入的目录，不含普通文件或损坏的符号链接。 */
    directories: SshDirectoryEntry[];
    /** 下一页游标；null 表示已列举完毕，目录变化时可刷新重新开始。 */
    next_cursor: string | null;
}
/** 只读浏览查询，分页游标只在当前路径生效。 */
export interface SshDirectoryQuery {
    /** 远端绝对目录；省略时只由远端 pwd 数据库取得登录用户 Home。 */
    path?: string;
    /** 上一页返回的原始游标，不参与 Shell 源码拼接。 */
    cursor?: string;
}

/** 不依赖 Python 的目录检查结果，供初始化和手动路径确认使用。 */
export interface SshDirectoryState {
    /** 已存在目录的真实路径，或基于最近已有父级解析后的待创建路径。 */
    path: string;
    /** 路径是否已经是当前登录用户可读取和进入的目录。 */
    exists: boolean;
}

/** 显式检查路径或创建目录的请求。 */
export interface SshDirectoryPreparation {
    /** 远端绝对路径；提供 name 时为已选择的父目录。 */
    path: string;
    /** 只允许一个文件夹名称，禁止路径分隔符、NUL、点和双点。 */
    name?: string;
    /** 用户已明确请求创建；省略或 false 时仅检查目录。 */
    create?: boolean;
}
