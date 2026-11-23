/** CLI 与运行中 City 的共享凭证读取器；数据库连接覆盖完整异步续期生命周期。 */
import { UserSessionRepository } from "@downcity/city/local";
import { Downtown, type FetchLike } from "@downcity/downtown";
import { create_cli_local_data } from "@/city/runtime/LocalData.js";

/** 固定绑定登录 session_id，账户切换后已创建的请求不会借用其他用户凭证。 */
export function shared_user_token_resolver(federation_url: string, session_id?: string): ((fetcher: FetchLike) => Promise<string>) | undefined {
  if (!session_id) return undefined;
  return async (fetcher) => {
    const data = create_cli_local_data();
    try { return await new UserSessionRepository(data.database).token(federation_url, session_id, fetcher); }
    finally { data.database.close(); }
  };
}

/** 先撤销本机使用权，再尽力撤销远端；失败返回 false，凭证不进入错误输出。 */
export async function revoke_saved_user_session(federation_url: string, session_id?: string, user_token?: string): Promise<boolean> {
  const data = create_cli_local_data();
  const row = session_id ? new UserSessionRepository(data.database).invalidate(federation_url, session_id) : null;
  data.database.close();
  const federation = new Downtown({ url: federation_url, user_token });
  try { await federation.user.account.logout(row?.refresh_token); return true; }
  catch { return false; }
  finally { await federation.dispose(); }
}
