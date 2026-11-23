/** Town 图片任务来源持久化协议；记录不包含 Token，不允许按页面当前账户反推来源。 */

/** 请求发送前就写入的来源事实。 */
export interface TownImageJobOrigin {
  /** Town 本地稳定任务句柄。 */
  job_id: string;
  /** 创建请求实际使用的连接。 */
  connection_id: string;
  /** 创建请求实际使用的授权来源。 */
  auth_scope_id: string;
  /** 创建时的目标地址，连接改地址后禁止查询。 */
  endpoint_url: string;
  /** 创建时的统一模型 ID。 */
  model_id: string;
  /** 原来源返回的任务 ID；pending 或结果未知时可能缺失，不能用于查询。 */
  original_job_id?: string;
  /** pending 表示尚未发出/尚未确认；unknown 表示请求可能已在原服务生效，不可重放。 */
  state: "pending" | "submitted" | "unknown";
  /** 创建记录的 ISO 时间，供宿主展示与审计。 */
  created_at: string;
}

/** 宿主应将单次 put 原子落盘；City 在远端请求发送前 await 首次写入。 */
export interface TownImageJobStore {
  /** 查询本地句柄；不存在时返回 undefined，不查询任意默认服务。 */
  get(job_id: string): Promise<TownImageJobOrigin | undefined>;
  /** 原子保存来源记录；失败须抛错，不得报告已持久化。 */
  put(origin: TownImageJobOrigin): Promise<void>;
}
