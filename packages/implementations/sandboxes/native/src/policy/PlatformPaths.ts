/**
 * 原生隔离的平台默认路径解析。
 *
 * 关键点（中文）
 * - 这里集中处理「宿主默认应该可写什么、必须拒绝读什么」，是平台分支的唯一位置。
 * - 最简配置：写白名单只留 Workspace、runtime、临时目录与设备节点目录；读只排除私钥与钥匙串。
 * - `/tmp` 在 macOS 是指向 `/private/tmp` 的符号链接，必须使用真实路径，否则白名单形同虚设。
 * - `/dev` 必须整棵子树可写：仅放行字面量会让 PTY 无法分配、git 无法打开 `/dev/null`。
 */

/** 一条需要强制拒绝读取的敏感路径。 */
export interface ProtectedPath {
  /** 宿主侧绝对路径。 */
  path: string;
  /** 匹配方式：整棵子树或单个文件。 */
  scope: "subpath" | "literal";
}

/** 解析平台写入根规则。 */
export function resolve_write_roots(input: {
  /** 目标平台。 */
  platform: NodeJS.Platform;
  /** 当前进程环境。 */
  env: NodeJS.ProcessEnv;
}): Array<{ path: string; access: "rw"; source: "temp" | "device"; scope: "subpath" }> {
  const temp_paths = input.platform === "darwin"
    ? ["/private/tmp", "/private/var/folders"]
    : ["/tmp", "/var/tmp"];
  return [
    ...temp_paths.map((temp_path) => ({
      path: temp_path,
      access: "rw" as const,
      source: "temp" as const,
      scope: "subpath" as const,
    })),
    {
      path: "/dev",
      access: "rw" as const,
      source: "device" as const,
      scope: "subpath" as const,
    },
  ];
}

/**
 * 解析平台敏感路径排除列表。
 *
 * 关键点（中文）
 * - 读隔离只能靠排除实现，因此这里的范围直接决定机密边界。
 * - 列表必须精确：整棵排除 `~/.config` 会让 git 每次读取 ignore 配置时报错。
 */
export function resolve_protected_paths(input: {
  /** 目标平台。 */
  platform: NodeJS.Platform;
  /** 当前进程环境，用于取 HOME。 */
  env: NodeJS.ProcessEnv;
}): ProtectedPath[] {
  const home_path = String(input.env.HOME || "").trim();
  if (!home_path) return [];
  if (input.platform === "darwin") {
    return [
      { path: `${home_path}/.ssh`, scope: "subpath" },
      { path: `${home_path}/Library/Keychains`, scope: "subpath" },
    ];
  }
  return [
    { path: `${home_path}/.ssh`, scope: "subpath" },
    { path: `${home_path}/.gnupg`, scope: "subpath" },
  ];
}
