/**
 * 精确归档记录的HTTP只读与删除入口。
 * UUID只在端点已绑定的Agent集合内解析；不创建Session actor，不调用模型和Workspace。
 */
import type { Hono } from "hono";
import type { AgentSessionCollection } from "@downcity/agent";

/** 由已认证的Agent HTTP组合根注册，身份不取自请求Agent字段。 */
export function register_archived_session_routes(app: Hono, sessions: AgentSessionCollection): void {
  for (const suffix of ["", "/messages", "/configuration", "/interactions"] as const) {
    app.get(`/api/sdk/archived-sessions/:storage_id${suffix}`, async c => {
      try {
        const storage_id = c.req.param("storage_id");
        if (!/^[0-9a-f-]{36}$/iu.test(storage_id)) return c.json({ success: false, error: "session_validation_error" }, 400);
        const view = await sessions.read_archived(storage_id);
        let data: unknown;
        if (suffix === "/messages") {
          const limit = c.req.query("limit");
          const before = c.req.query("before_sequence");
          data = await view.messages({ ...(limit === undefined ? {} : { limit: Number(limit) }),
            ...(before === undefined ? {} : { before_sequence: Number(before) }) });
        } else if (suffix === "/configuration") data = await view.configuration();
        else if (suffix === "/interactions") data = await view.interactions();
        else data = { storage_id: view.storage_id, metadata: view.metadata, archived: true };
        return c.json({ success: true, data });
      } catch (error) {
        const code = error instanceof Error ? error.message.split(":", 1)[0] : "session_storage_read_failed";
        return c.json({ success: false, error: code }, code === "session_not_found" ? 404 : 400);
      }
    });
  }
  app.delete("/api/sdk/archived-sessions/:storage_id", async c => {
    try {
      const storage_id = c.req.param("storage_id");
      if (!/^[0-9a-f-]{36}$/iu.test(storage_id)) return c.json({ success: false, error: "session_validation_error" }, 400);
      return c.json({ success: true, data: await sessions.remove_archived(storage_id) });
    } catch (error) {
      return c.json({ success: false, error: error instanceof Error ? error.message.split(":", 1)[0] : "session_storage_transaction_failed" }, 400);
    }
  });
}
