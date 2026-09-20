/**
 * Workspace 文件的路径与 `file://` 链接构造。
 *
 * ## 为什么单独一个模块
 *
 * 「复制链接」在两个表面各出现一次（Chat 右侧「文件」面板与 Workspace 主视图），
 * 而 diff 卡片此前也自己写了一份同名实现。链接格式必须唯一——它由
 * `resolve_desktop_link` 反向解析（含末尾 `:行号` 后缀），两份实现漂移就会出现
 * 「某个入口复制的链接粘回输入框解析不出文件」。
 *
 * ## 链接形状
 *
 * ```text
 * file:///Users/me/project/docs/readme.md:45
 * └─ 协议 ─┘└──── 绝对路径（逐段编码）────┘└ 可选行号
 * ```
 *
 * 行号后缀是**链接的一部分**：用户在源码视图里定位到第 45 行后复制链接，
 * 期望对方打开时也落在那一行。
 *
 * ## 没有 Workspace 绝对路径时退化为相对路径
 *
 * Workspace 未登记（或已移除）时无法构造绝对路径。此时返回相对路径而不是空值：
 * 它仍可粘贴到对话里，由当前 Workspace 上下文解析；返回空值等于「复制了一个空字符串」，
 * 那比退化更糟。
 */

/** 构造可粘贴并解析回 Workspace 文件的链接。 */
export function build_workspace_file_link(workspace_path: string | undefined, relative_path: string, line?: number): string {
  const normalized_relative = relative_path.replace(/\\/g, "/");
  if (!workspace_path) return line ? `${normalized_relative}:${line}` : normalized_relative;
  const root = workspace_path.replace(/\\/g, "/").replace(/\/+$/, "");
  // 逐段路径都要有前导 `/`：`file://` 的 host 段与路径段不能混在一起。
  const absolute_path = root.startsWith("/") ? `${root}/${normalized_relative}` : `/${root}/${normalized_relative}`;
  return `file://${encodeURI(absolute_path)}${line ? `:${line}` : ""}`;
}

/**
 * 解析文件在本机的绝对路径；Workspace 未登记时返回 undefined。
 *
 * 「用系统默认应用打开」需要真实绝对路径（主进程会拒绝相对路径），
 * 而路径拼接只应有一处实现——否则它会与上面那个链接构造函数各写一遍归一化，
 * 两者迟早不一致。
 */
export function resolve_workspace_absolute_path(workspace_path: string | undefined, relative_path: string): string | undefined {
  if (!workspace_path) return undefined;
  const root = workspace_path.replace(/\\/g, "/").replace(/\/+$/, "");
  const separator = root.includes("/") ? "/" : "\\";
  const normalized_relative = relative_path.replace(/\\/g, separator).replace(/^\/+/, "");
  return root ? `${root}${separator}${normalized_relative}` : undefined;
}
