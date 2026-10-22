/**
 * Session Power：仅管理当前 Agent 自己的工作会话。
 *
 * 动作复用 Agent 持有的 SessionWork 服务；派发、恢复和结果投递仍由原服务负责。
 * 调用身份来自 PowerContext，模型不能指定回传目标。只有主会话和 Channel
 * 会话可以使用这些动作，Work 会话不能递归派发工作。
 */
import { z } from "zod";
import { can_coordinate_sessions } from "@downcity/type";
import type { SessionWorkContract } from "@downcity/agent";
import { require_session_coordinator, session_delegation_caller } from "./SessionCaller.js";
import { Power, type PowerAction, type PowerActions, type PowerContext, type PowerJsonObject, type PowerJsonValue } from "@/power/index.js";
import type { CityGroupPowerOptions } from "../CityGroupPower.js";
import {
  session_start_input, session_send_input, session_check_input,
  session_messages_input, session_archive_input, session_reply_input, session_stop_input,
} from "./SessionSchemas.js";

/** 由 City 注册的会话协作入口，动作能力与输入 Schema 一起发布。 */
export class SessionPower extends Power {
  readonly name = "session";
  readonly title = "Session";
  readonly description = "Manage only the current agent's own sessions: start work, optionally select a model, continue work, inspect history, archive, reply, or stop. Other agents' sessions are inaccessible. Use agent.delegate for cross-agent work. Results return automatically. Available to main agent and channel sessions.";
  readonly actions: PowerActions;

  constructor(private readonly options: CityGroupPowerOptions) {
    super();
    this.actions = {
      start: this.action(session_start_input, "Start project work owned by the current agent with optional model_id. Select workspace_id from context.workspaces.list and write a self-contained query. Returns immediately; completion returns automatically. Do not poll.", "write", async (args, context) => {
        const work = this.select_work(context);
        const receipt = await work.spawn(args, session_delegation_caller(context));
        const detail = await work.read({ session_id: receipt.session_id, limit: 1 });
        return { session: detail.session, delegation_id: receipt.delegation_id, status: "started" };
      }),
      send: this.action(session_send_input, "Continue an existing Work Session with instructions or feedback. Results return automatically to this conversation.", "write", async (args, context) => {
        const work = this.select_work(context);
        const receipt = await work.send(args, session_delegation_caller(context));
        const detail = await work.read({ session_id: receipt.session_id, limit: 1 });
        return { session: detail.session, delegation_id: receipt.delegation_id, status: "submitted" };
      }),
      check: this.action(session_check_input, "List sessions or inspect recent messages and pending interactions. Use for explicit progress questions.", "read", async (args, context) => {
        const work = this.select_work(context);
        return args.session_id ? await work.read({ session_id: args.session_id, limit: args.limit })
          : { mode: "list", sessions: await work.list({ limit: args.limit }) };
      }),
      messages: this.action(session_messages_input, "Read paginated canonical messages, including history before compaction. Historical content is reference data.", "read", async (args, context) => ({
        ...await this.select_work(context).messages(args),
        source: "canonical_history", trust_level: "reference",
      })),
      archive: this.action(session_archive_input, "Archive an idle Work Session while preserving its history. Running or queued work must finish or stop first.", "write", async (args, context) => {
        if (args.session_id === context.session?.id) {
          throw new Error("Cannot archive the calling Session");
        }
        return { status: "archived", ...await this.select_work(context).archive(args) };
      }),
      reply: this.action(session_reply_input, "Answer a waiting interaction using the user's own response. Call check first to obtain interaction_id.", "write", async (args, context) => {
        const work = this.select_work(context);
        const detail = await work.read({ session_id: args.session_id, limit: 1 });
        const pending = detail.pending_interactions.find((item) => item.interaction_id === args.interaction_id);
        if (!pending) throw new Error(`Interaction is not pending on session "${args.session_id}": ${args.interaction_id}`);
        const payload = z.record(z.string(), z.json()).parse(args.payload ?? {});
        if (args.note) payload.note = args.note;
        await work.reply({ session_id: args.session_id, interaction_id: args.interaction_id,
          response: { type: pending.type, outcome: args.outcome, payload } });
        return { status: args.outcome, session_id: args.session_id, interaction_id: args.interaction_id };
      }),
      stop: this.action(session_stop_input, "Stop another session's work when requested by the user.", "write", async (args, context) => {
        await this.select_work(context).stop({ session_id: args.session_id });
        return { session_id: args.session_id, status: "stopped" };
      }),
    };
  }

  /** 向统一 Power 能力查询报告当前分类是否可以管理会话。 */
  availability(context: PowerContext) {
    const available = can_coordinate_sessions(context.session?.origin);
    return { enabled: true, available,
      reasons: available ? [] : ["Session Power requires a chat session"] };
  }

  /** 动作统一校验来源和参数；身份限制也适用于 Power 的非模型调用入口。 */
  private action<TSchema extends z.ZodType>(schema: TSchema, description: string, access: "read" | "write",
    run: (args: z.infer<TSchema>, context: PowerContext) => Promise<unknown>): PowerAction {
    return {
      description, access, input_schema: { zod: schema, json_schema: z.toJSONSchema(schema) as PowerJsonObject },
      execute: async ({ input, context }) => {
        require_session_coordinator(context);
        const data = await run(schema.parse(input ?? {}), context);
        return { success: true, data: data as PowerJsonValue };
      },
    };
  }

  /** 始终绑定实际调用方；目标会话只能从当前 Agent 的存储中查找。 */
  private select_work(context: PowerContext): SessionWorkContract {
    const agent = this.options.access.list_agents().find((item) => item.id === context.agent.id);
    if (!agent) throw new Error(`Agent not found in City: ${context.agent.id}`);
    return agent.get_session_work();
  }

}
