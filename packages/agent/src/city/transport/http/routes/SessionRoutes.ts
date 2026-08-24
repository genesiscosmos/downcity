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
  AgentArchiveSessionInput,
  AgentArchiveSessionsInput,
  RemoteSessionSetInput,
} from "@/index.js";
import type { AgentSessionCollection } from "@/types/agent/AgentSessionCollection.js";
import type { WorkspaceBase } from "@downcity/workspace";
import type { AgentSessionPromptInput } from "@/index.js";
import type { RespondSessionInteractionInput } from "@/index.js";
import type { AgentHttpRuntimeOptions } from "@/city/transport/types/AgentHttpRuntime.js";
import { resolve_remote_session_set_input } from "@/city/transport/session/RemoteSessionConfig.js";

const NDJSON_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";
const SDK_EVENTS_READY_FRAME = {
  type: "sdk-events-ready",
} as const;

/**
 * 注册 SDK session 路由。
 */
export function register_sdk_session_routes(
  app: Hono,
  sessions: AgentSessionCollection,
  workspace?: WorkspaceBase,
  runtime_options: AgentHttpRuntimeOptions = {},
): void {
  const get_session = async (session_id: string) => await sessions.get(
    session_id,
    workspace ? { workspace } : undefined,
  );
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
      await c.req.json().catch(() => ({}));
      const session = await sessions.create(workspace ? { workspace } : undefined);
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
      const session = await get_session(session_id);
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
      const session = await get_session(session_id);
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
      const session = await get_session(session_id);
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
      const session = await get_session(session_id);
      const compact = await session.compact();
      return c.json({ success: true, compact: { id: compact.id } });
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
      const session = await get_session(session_id);
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
      const session = await get_session(session_id);
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
      const session = await get_session(session_id);
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
        include_message?: unknown;
      };
      const session = await get_session(session_id);
      const message_id = String(body.message_id || "").trim() || undefined;
      const forked = await session.fork(message_id ? {
        message_id,
        include_message: body.include_message !== false,
      } : undefined);
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

  app.get("/api/sdk/sessions/:session_id/interactions", async (c) => {
    try {
      const session = await get_session(String(c.req.param("session_id") || "").trim());
      return c.json({ success: true, interactions: await session.interactions() });
    } catch (error) {
      return c.json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.get("/api/sdk/sessions/:session_id/status", async (c) => {
    try {
      const session = await get_session(String(c.req.param("session_id") || "").trim());
      return c.json({ success: true, status: await session.status() });
    } catch (error) {
      return c.json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/sdk/sessions/:session_id/set", async (c) => {
    try {
      const session = await get_session(String(c.req.param("session_id") || "").trim());
      const body = await c.req.json().catch(() => null) as {
        model_id?: unknown;
        security?: { approval_mode?: unknown };
        options?: {
          persist_action?: unknown;
          publish_mutation?: unknown;
        };
      } | null;
      const mode = body?.security
        ? String(body.security.approval_mode || "")
        : undefined;
      if (mode !== undefined && mode !== "ask" && mode !== "always-allow") {
        return c.json({
          success: false,
          error: "security.approval_mode must be ask or always-allow",
        }, 400);
      }
      const model_id = body?.model_id === undefined
        ? undefined
        : String(body.model_id || "").trim();
      if (body?.model_id !== undefined && !model_id) {
        return c.json({
          success: false,
          error: "model_id must be a non-empty string",
        }, 400);
      }
      const persist_action = body?.options?.persist_action;
      const publish_mutation = body?.options?.publish_mutation;
      if (persist_action !== undefined && typeof persist_action !== "boolean") {
        return c.json({
          success: false,
          error: "options.persist_action must be boolean",
        }, 400);
      }
      if (publish_mutation !== undefined && typeof publish_mutation !== "boolean") {
        return c.json({
          success: false,
          error: "options.publish_mutation must be boolean",
        }, 400);
      }
      const remote_input: RemoteSessionSetInput = {
        ...(model_id ? { model_id } : {}),
        ...(mode ? { security: { approval_mode: mode } } : {}),
      };
      const input = await resolve_remote_session_set_input({
        config: remote_input,
        resolve_session_model: runtime_options.resolve_session_model,
      });
      await session.set(
        input,
        {
          ...(typeof persist_action === "boolean" ? { persist_action } : {}),
          ...(typeof publish_mutation === "boolean" ? { publish_mutation } : {}),
        },
      );
      return c.json({ success: true, queued: true });
    } catch (error) {
      return c.json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/sdk/sessions/:session_id/respond", async (c) => {
    try {
      const session = await get_session(String(c.req.param("session_id") || "").trim());
      const body = await c.req.json().catch(() => null) as Partial<RespondSessionInteractionInput> | null;
      const interaction_id = String(body?.interaction_id || "").trim();
      if (!interaction_id) {
        return c.json({ success: false, error: "interaction_id is required" }, 400);
      }
      if (!body?.response || typeof body.response !== "object") {
        return c.json({ success: false, error: "response is required" }, 400);
      }
      const result = await session.respond({
        interaction_id,
        response: body.response,
      });
      return c.json({ success: true, result });
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
