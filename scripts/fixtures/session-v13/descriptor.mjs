/** 冻结的 v13 协议，仅供离线迁移；不得作为当前 SDK 运行实现。 */
/**
 * Session 的业务类型、入口用途和已有派生关系。
 * type 只区分对话与工作；kind 由创建方命名，不推断权限或执行配置。
 * parent 是 Session 创建事实的投影，消息、Turn 与跨对象引用继续使用 session_id。
 */

/** 对话 Session。 */
export const SESSION_TYPE_CHAT = "chat";
/** 工作 Session。 */
export const SESSION_TYPE_WORK = "work";
/** 本地 Agent 主对话入口。 */
export const SESSION_KIND_MAIN = "main";
/** 远程对话入口。 */
export const SESSION_KIND_REMOTE = "remote";
/** 消息渠道入口。 */
export const SESSION_KIND_CHANNEL = "channel";
/** 群组成员对话入口。 */
export const SESSION_KIND_GROUP = "group";
/** 浏览器入口。 */
export const SESSION_KIND_CHROME = "chrome";
/** 默认工作用途。 */
export const SESSION_KIND_WORK = "work";
/** 任务运行用途。 */
export const SESSION_KIND_TASK = "task";
/** 工作派生允许的最大深度；Chat 为 0，Main 为 1，Child 为 2。 */
export const SESSION_DELEGATION_MAX_DEPTH = 2;

/** Session 顶层类型的封闭取值。 */
                                          

/** 实际创建当前 Session 的父执行引用。 */
                                
                           
                            
                              
                              
                                  
                            
                               
                            
 

/** 持久化的 Session 创建描述；派生信息沿用创建记录，不在查询时重新构造。 */
                                    
                     
                             
                               
                        
                     
                                  
                              
                                     
                               
                                             
                             
                                         
                     
                             
                       
                                     
 

/** 校验 Session 顶层类型，不按 kind 推断类型。 */
export function normalize_session_type(input         )              {
  if (input === "chat" || input === "work") return input;
  throw new Error('Session type requires "chat" or "work"');
}

/** 规范化创建方自定义的非空用途。 */
export function normalize_session_kind(input         )         {
  const kind = typeof input === "string" ? input.trim() : "";
  if (!kind) throw new Error("Session kind requires a non-empty string");
  return kind;
}

/** 规范化创建描述；未指定字段时独立使用 work/work。 */
export function normalize_session_descriptor(input                             )                    {
  if (input !== undefined && (!input || typeof input !== "object" || Array.isArray(input))) throw new Error("Session creation fields require an object");
  const descriptor                    = {
    type: normalize_session_type(input?.type === undefined ? "work" : input.type),
    kind: normalize_session_kind(input?.kind === undefined ? "work" : input.kind),
    ...(input?.parent === undefined ? {} : { parent: Object.freeze({ ...input.parent }) }),
    ...(input?.delegation_depth === undefined ? {} : { delegation_depth: input.delegation_depth }),
    ...(input?.parent_session_type === undefined ? {} : { parent_session_type: normalize_session_type(input.parent_session_type) }),
    ...(input?.root_chat_session_id === undefined ? {} : { root_chat_session_id: input.root_chat_session_id }),
    ...(input?.group_id === undefined ? {} : { group_id: input.group_id }),
    ...(input?.group_session_id === undefined ? {} : { group_session_id: input.group_session_id }),
  };
  if (descriptor.parent) {
    const parent = descriptor.parent;
    if (typeof parent.agent_id !== "string" || !parent.agent_id.trim()
      || typeof parent.session_id !== "string" || !parent.session_id.trim()
      || (parent.turn_id !== undefined && (typeof parent.turn_id !== "string" || !parent.turn_id.trim()))
      || (parent.call_id !== undefined && (typeof parent.call_id !== "string" || !parent.call_id.trim()))) throw new Error("Session parent requires valid creation references");
  }
  return Object.freeze(descriptor);
}

/** 从当前正式存储字段恢复描述，并校验可选的类型期望。 */
export function restore_session_descriptor(input                   , expected_type         )                    {
  const descriptor = normalize_session_descriptor(input);
  if (expected_type !== undefined && descriptor.type !== normalize_session_type(expected_type)) throw new Error("Session type does not match expected type");
  return descriptor;
}

/** 已有工作规则的派生深度；关系不完整时拒绝继续派发。 */
export function read_session_delegation_depth(descriptor                                        )         {
  if (descriptor?.delegation_depth !== undefined) {
    const depth = descriptor.delegation_depth;
    return Number.isInteger(depth) && depth >= 0 ? depth : Number.POSITIVE_INFINITY;
  }
  if (descriptor?.type === "chat" && !descriptor.parent) return 0;
  if (descriptor?.type === "work" && !descriptor.parent) return 1;
  return Number.POSITIVE_INFINITY;
}

/** 返回现有调度规则阻止继续派发的原因。 */
export function resolve_delegation_blocked_reason(descriptor                                        )                {
  if (descriptor?.kind === "task") return "Task Sessions must execute the current run directly and cannot delegate work";
  if (descriptor?.type !== "chat" && descriptor?.type !== "work") return "Session type cannot delegate work";
  const depth = read_session_delegation_depth(descriptor);
  if (!Number.isFinite(depth)) return "session_relation_invalid: incomplete Work derivation";
  if (depth >= SESSION_DELEGATION_MAX_DEPTH) return `Session delegation depth limit reached (max ${SESSION_DELEGATION_MAX_DEPTH})`;
  if (descriptor.type === "chat" && depth !== 0) return "Invalid Chat delegation depth";
  if (descriptor.type === "work" && depth !== 1) return "Invalid Work delegation depth";
  return null;
}

/** 当前创建事实是否允许继续派发工作。 */
export function can_delegate_work(descriptor                                        )          {
  return resolve_delegation_blocked_reason(descriptor) === null;
}

/** 当前描述是否属于本地主会话入口。 */
export function is_main_session(descriptor                                        )          {
  return descriptor?.type === "chat" && descriptor.kind === "main";
}
