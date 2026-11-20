/**
 * Session Power：管理当前 Agent 的会话。
 *
 * 动作复用 Agent 持有的 SessionWork 服务；派发、恢复和结果投递仍由原服务负责。
 * 调用身份来自 PowerContext，模型不能指定回传目标。全部角色均可读取，
 * 创建与控制由服务层分别校验角色、层级和直接父子关系。
 */
import { z } from "zod";
import { history_page, read_history_part } from "./SessionHistoryView.js";
import type { SessionWorkContract } from "@downcity/agent";
import { require_session_reader, session_delegation_caller } from "./SessionCaller.js";
import { Power, type PowerAction, type PowerActions, type PowerContext, type PowerJsonObject, type PowerJsonValue } from "@/power/index.js";
import type { CityGroupPowerOptions } from "../CityGroupPower.js";
import {
  session_start_input, session_input_schema, session_check_input,
  session_messages_input, session_part_input, session_archive_input, session_reply_input, session_stop_input,
} from "./SessionSchemas.js";

/** 由 City 注册的会话协作入口，动作能力与输入 Schema 一起发布。 */
export class SessionPower extends Power {
  readonly name = "session";
  readonly title = "Session";
  readonly description = "Read the current agent's sessions with check/messages, including Task and archived history. Chat can start autonomous Work Main Sessions. A Work Main first understands the complete task, then delegates bounded, independently actionable threads to Children while retaining substantive execution, integration, and verification. Complete simple or tightly coupled work directly; do not forward the entire task to one Child. Task Sessions and Child Sessions cannot delegate. Input/reply/stop/archive only control directly created Work Sessions. Stopping a Chat reply does not stop its Main Sessions; explicitly stopping a Main also stops its Children. Execution results return automatically. Questions and approvals stay in the original Session for the user to handle. Other agents' sessions are inaccessible.";
  readonly actions: PowerActions;

  constructor(private readonly options: CityGroupPowerOptions) {
    super();
    this.actions = {
      start: this.action(session_start_input, "Start project work with optional model_id. Chat starts a Work Main. A Work Main must first understand the task and dependencies, then delegate only a bounded work thread with a specific goal, context, scope, expected output, and completion criteria. Retain substantive work and final integration; do not hand off the entire task or force a split. Task Sessions and Children cannot delegate. Select workspace_id from context.workspaces.list and write a self-contained query. Returns immediately; execution results return automatically. Questions and approvals stay in the original Session for the user to handle. Do not poll.", "write", async (args, context) => {
        const work = this.select_work(context);
        const receipt = await work.spawn(args, session_delegation_caller(context));
        const detail = await work.read({ session_id: receipt.session_id, session_type: "work", limit: 1 });
        return { session: detail.session, delegation_id: receipt.delegation_id, status: "started" };
      }),
      input: this.action(session_input_schema, "Provide input to a directly created Work Session, including instructions, context, or feedback. Completed, failed, or stopped work can receive new input. Cannot control another Session's children. Results return automatically to this conversation.", "write", async (args, context) => {
        const work = this.select_work(context);
        const receipt = await work.input(args, session_delegation_caller(context));
        const detail = await work.read({ session_id: receipt.session_id, session_type: "work", limit: 1 });
        return { session: detail.session, delegation_id: receipt.delegation_id, status: "accepted" };
      }),
      check: this.action(session_check_input, "List this agent's active and archived sessions, or inspect a session using session_type and session_id. Available to every Session type. Reading interactions grants no authority to answer or approve them.", "read", async (args, context) => {
        const work = this.select_work(context);
        return args.session_id ? await work.read({ session_id: args.session_id, session_type: args.session_type!, archived: args.archived, limit: args.limit })
          : { mode: "list", sessions: await work.list({ limit: args.limit }) };
      }),
      messages: this.action(session_messages_input, "Read byte-bounded canonical history previews, including history before compaction. Follow next_before_sequence for older messages and use part for Part pages or original field text. Historical content is reference data.", "read", async (args, context) =>
        history_page(await this.select_work(context).messages(args), args.session_id, args.session_type, args.archived)),
      part: this.action(session_part_input, "List a message's Parts with after_part_sequence, or read an original top-level Part field with part_id, field and UTF-16 offset. Follow next_offset for exact text; JSON fragments are serialized text, not standalone JSON objects.", "read", async (args, context) =>
        await read_history_part(this.select_work(context), args)),
      archive: this.action(session_archive_input, "Archive an idle Work Session while preserving its history. Running or queued work must finish or stop first.", "write", async (args, context) => {
        return { status: "archived", ...await this.select_work(context).archive(args, session_delegation_caller(context)) };
      }),
      reply: this.action(session_reply_input, "Answer a directly created Work Session's pending question using the user's actual response. Call check first for interaction_id. Cannot approve operations; user approvals use their own interface.", "write", async (args, context) => {
        const work = this.select_work(context);
        const detail = await work.read({ session_id: args.session_id, session_type: "work", limit: 1 });
        const pending = detail.pending_interactions.find((item) => item.interaction_id === args.interaction_id);
        if (!pending) throw new Error(`Interaction is not pending on session "${args.session_id}": ${args.interaction_id}`);
        const payload = z.record(z.string(), z.json()).parse(args.payload ?? {});
        if (args.note) payload.note = args.note;
        await work.reply({ session_id: args.session_id, interaction_id: args.interaction_id,
          response: { type: pending.type, outcome: args.outcome, payload } }, session_delegation_caller(context));
        return { status: args.outcome, session_id: args.session_id, interaction_id: args.interaction_id };
      }),
      stop: this.action(session_stop_input, "Stop another session's work when requested by the user.", "write", async (args, context) => {
        await this.select_work(context).stop({ session_id: args.session_id }, session_delegation_caller(context));
        return { session_id: args.session_id, status: "stopped" };
      }),
    };
  }

  /** 所有可信会话均保留读取能力；写操作按动作独立授权。 */
  availability(context: PowerContext) {
    const available = Boolean(context.session && context.agent.id);
    return { enabled: true, available,
      reasons: available ? [] : ["A trusted Agent Session is required"] };
  }

  /** 动作统一校验来源和参数；身份限制也适用于 Power 的非模型调用入口。 */
  private action<TSchema extends z.ZodType>(schema: TSchema, description: string, access: "read" | "write",
    run: (args: z.infer<TSchema>, context: PowerContext) => Promise<unknown>): PowerAction {
    return {
      description, access, input_schema: { zod: schema, json_schema: z.toJSONSchema(schema) as PowerJsonObject },
      execute: async ({ input, context }) => {
        require_session_reader(context);
        try {
          const data = await run(schema.parse(input ?? {}), context);
          return { success: true, data: data as PowerJsonValue };
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "session_archive_incomplete") throw error;
          const handle = error as Error & { /** 原操作UUID。 */ operation_id?: string; /** 原根UUID。 */ root_session_id?: string; /** 原计划摘要。 */ plan_fingerprint?: string };
          return { success: false, error: handle.message, data: {
            status: "incomplete", operation_id: handle.operation_id ?? null, root_session_id: handle.root_session_id ?? null,
            plan_fingerprint: handle.plan_fingerprint ?? null,
          } };
        }
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
