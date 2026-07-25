/**
 * SDK HTTP session 路由。
 *
 * 关键点（中文）
 * - 这组路由面向 `RemoteAgent`，只暴露最小 Session actor 使用面。
 * - 当前公开输入收口到 `prompt()`，公开输出收口到 `events` 长连接。
 * - 不复用 control API 的控制台语义，避免 transport 面混入非 SDK 约束。
 */

import type { Hono } from "hono";
import type {
  AgentListSessionsInput,
  AgentSessions,
  AgentArchiveSessionInput,
  AgentArchiveSessionsInput,
} from "@downcity/agent";
import type { AgentSessionPromptInput } from "@downcity/agent";
import type { SessionApprovalDecision, SessionApprovalMode } from "@downcity/agent";

const NDJSON_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";
const SDK_EVENTS_READY_FRAME = {
  type: "sdk-events-ready",
} as const;

/**
 * 注册 SDK session 路由。
 */
export function registerSdkSessionRoutes(
  app: Hono,
  sessions: AgentSessions,
): void {
  app.get("/api/sdk/sessions", async (c) => {
    try {
      const input: AgentListSessionsInput = {
        ...(c.req.query("limit") ? { limit: Number(c.req.query("limit")) } : {}),
        ...(c.req.query("cursor") ? { cursor: c.req.query("cursor") } : {}),
        ...(c.req.query("query") ? { query: c.req.query("query") } : {}),
      };
      const page = await sessions.list(input);
      return c.json({
        success: true,
        page,
        sessions: page.items,
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  });

  app.post("/api/sdk/sessions", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        session_id?: unknown;
      };
      const session = await sessions.create({
        ...(body.session_id ? { session_id: String(body.session_id).trim() } : {}),
      });
      return c.json({
        success: true,
        session: await session.get_info(),
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  });

  app.get("/api/sdk/sessions/:session_id", async (c) => {
    try {
      const session_id = String(c.req.param("session_id") || "").trim();
      if (!session_id) {
        return c.json({ success: false, error: "Missing session_id" }, 400);
      }
      const session = await sessions.get(session_id);
      return c.json({
        success: true,
        session: await session.get_info(),
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  });

  app.post("/api/sdk/sessions/:session_id/prompt", async (c) => {
    try {
      const session_id = String(c.req.param("session_id") || "").trim();
      if (!session_id) {
        return c.json({ success: false, error: "Missing session_id" }, 400);
      }
      const body = (await c.req.json()) as AgentSessionPromptInput;
      const session = await sessions.get(session_id);
      const turn = await session.prompt(body);
      return c.json({
        success: true,
        turn: {
          id: turn.id,
        },
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  });

  app.post("/api/sdk/sessions/:session_id/stop", async (c) => {
    try {
      const session_id = String(c.req.param("session_id") || "").trim();
      if (!session_id) {
        return c.json({ success: false, error: "Missing session_id" }, 400);
      }
      const session = await sessions.get(session_id);
      const result = await session.stop();
      return c.json({
        success: true,
        result,
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  });

  app.post("/api/sdk/sessions/:session_id/compact", async (c) => {
    try {
      const session_id = String(c.req.param("session_id") || "").trim();
      if (!session_id) {
        return c.json({ success: false, error: "Missing session_id" }, 400);
      }
      const session = await sessions.get(session_id);
      await session.compact();
      return c.json({ success: true, queued: true });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  });

  app.get("/api/sdk/sessions/:session_id/events", async (c) => {
    const session_id = String(c.req.param("session_id") || "").trim();
    if (!session_id) {
      return c.json({ success: false, error: "Missing session_id" }, 400);
    }

    try {
      const session = await sessions.get(session_id);
      const encoder = new TextEncoder();
      const requestSignal = c.req.raw.signal;

      let cleanupEventsConnection = (): void => {};
      const stream = new ReadableStream<Uint8Array>({
        cancel() {
          cleanupEventsConnection();
        },
        start(controller) {
          const writeLine = (value: unknown): void => {
            controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
          };

          // HTTP transport 既要转发持久化 mutation，也要转发 turn 生命周期，
          // 否则 RemoteSession 无法收到 turn-finish 并兑现 turn.finished。
          const unsubscribe = session.subscribe((event) => {
            writeLine(event);
          });

          const closeStream = (): void => {
            cleanupEventsConnection();
            try {
              controller.close();
            } catch {
              // ignore duplicate close attempts
            }
          };

          cleanupEventsConnection = (): void => {
            unsubscribe();
            requestSignal.removeEventListener("abort", closeStream);
          };

          if (requestSignal.aborted) {
            closeStream();
            return;
          }

          requestSignal.addEventListener("abort", closeStream, { once: true });
          writeLine(SDK_EVENTS_READY_FRAME);
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": NDJSON_CONTENT_TYPE,
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  });

  app.get("/api/sdk/sessions/:session_id/messages", async (c) => {
    try {
      const session_id = String(c.req.param("session_id") || "").trim();
      if (!session_id) {
        return c.json({ success: false, error: "Missing session_id" }, 400);
      }
      const session = await sessions.get(session_id);
      const messages = await session.messages({
        ...(c.req.query("before_sequence")
          ? { before_sequence: Number(c.req.query("before_sequence")) }
          : {}),
        ...(c.req.query("include_internal") === "true"
          ? { include_internal: true }
          : {}),
      });
      return c.json({
        success: true,
        messages,
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  });

  app.get("/api/sdk/sessions/:session_id/system", async (c) => {
    try {
      const session_id = String(c.req.param("session_id") || "").trim();
      if (!session_id) {
        return c.json({ success: false, error: "Missing session_id" }, 400);
      }
      const session = await sessions.get(session_id);
      return c.json({
        success: true,
        system: await session.system(),
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  });

  app.post("/api/sdk/sessions/:session_id/fork", async (c) => {
    try {
      const session_id = String(c.req.param("session_id") || "").trim();
      if (!session_id) {
        return c.json({ success: false, error: "Missing session_id" }, 400);
      }
      const body = (await c.req.json().catch(() => ({}))) as {
        message_id?: unknown;
      };
      const session = await sessions.get(session_id);
      const forked = await session.fork(
        String(body.message_id || "").trim() || undefined,
      );
      return c.json({
        success: true,
        session: await forked.get_info(),
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  });

  app.post("/api/sdk/sessions/:session_id/archive", async (c) => {
    try {
      const session_id = String(c.req.param("session_id") || "").trim();
      if (!session_id) {
        return c.json({ success: false, error: "Missing session_id" }, 400);
      }
      const input: AgentArchiveSessionInput = { id: session_id };
      const result = await sessions.archive(input);
      return c.json({
        success: true,
        session_id: result.session_id,
        archived_at: result.archived_at,
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  });

  app.get("/api/sdk/sessions/:session_id/approvals", async (c) => {
    try {
      const session = await sessions.get(String(c.req.param("session_id") || "").trim());
      return c.json({ success: true, approvals: await session.approvals() });
    } catch (error) {
      return c.json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.get("/api/sdk/sessions/:session_id/approval-mode", async (c) => {
    try {
      const session = await sessions.get(String(c.req.param("session_id") || "").trim());
      return c.json({ success: true, ...(await session.approval_mode()) });
    } catch (error) {
      return c.json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/sdk/sessions/:session_id/approval-mode", async (c) => {
    try {
      const session = await sessions.get(String(c.req.param("session_id") || "").trim());
      const body = await c.req.json().catch(() => null) as { mode?: unknown } | null;
      const mode = String(body?.mode || "") as SessionApprovalMode;
      if (mode !== "ask" && mode !== "always-allow") {
        return c.json({ success: false, error: "mode must be ask or always-allow" }, 400);
      }
      return c.json({ success: true, ...(await session.set_approval_mode({ mode })) });
    } catch (error) {
      return c.json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/sdk/sessions/:session_id/approval", async (c) => {
    try {
      const session = await sessions.get(String(c.req.param("session_id") || "").trim());
      const body = await c.req.json().catch(() => null) as {
        approval_id?: unknown;
        decision?: unknown;
      } | null;
      const approval_id = String(body?.approval_id || "").trim();
      const decision = String(body?.decision || "") as SessionApprovalDecision;
      if (!approval_id) return c.json({ success: false, error: "approval_id is required" }, 400);
      if (decision !== "approved" && decision !== "denied") {
        return c.json({ success: false, error: "decision must be approved or denied" }, 400);
      }
      const result = await session.resolve_approval({ approval_id, decision });
      return c.json(result, result.success ? 200 : 404);
    } catch (error) {
      return c.json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.get("/api/sdk/archived-sessions", async (c) => {
    try {
      const input: AgentArchiveSessionsInput = {
        ...(c.req.query("limit") ? { limit: Number(c.req.query("limit")) } : {}),
        ...(c.req.query("cursor") ? { cursor: c.req.query("cursor") } : {}),
        ...(c.req.query("query") ? { query: c.req.query("query") } : {}),
      };
      const page = await sessions.archived(input);
      return c.json({
        success: true,
        page,
        sessions: page.items,
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  });

  app.delete("/api/sdk/archived-sessions", async (c) => {
    try {
      const result = await sessions.clean_archive();
      return c.json({
        success: true,
        removed_session_ids: result.removed_session_ids,
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  });
}
