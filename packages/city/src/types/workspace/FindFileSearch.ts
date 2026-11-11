/** 本地文件发现的进程输入与有界结果；glob 始终相对已校验的搜索目录匹配。 */

/** ripgrep 文件枚举及 POSIX glob 筛选参数。 */
export interface FindFileSearchOptions {
  /** 已通过工作区路径策略校验的项目根目录，用于生成项目相对结果。 */
  readonly root_path: string;
  /** 已校验存在的绝对目录；只接收此目录内相对路径符合 glob 的结果。 */
  readonly search_path: string;
  /** 相对搜索目录的正向 POSIX glob，包含花括号和 extglob 语义。 */
  readonly pattern: string;
  /** 最多保留的匹配文件数；发现额外匹配时标记截断并终止进程。 */
  readonly max_results: number;
  /** 请求生命周期的取消信号；取消会终止枚举进程并返回 aborted。 */
  readonly abort_signal?: AbortSignal;
}

/** 文件枚举完成后交给公共 find action 的结果。 */
export interface FindFileSearchResult {
  /** 已排序的项目相对 POSIX 路径，数量不超过请求上限。 */
  files: string[];
  /** 是否实际发现了超出结果上限的额外匹配。 */
  truncated: boolean;
}
