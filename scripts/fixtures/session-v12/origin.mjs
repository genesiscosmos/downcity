/** Frozen published v12 protocol from 9a983f62a; offline conversion only. */
/**
 * Session 来源元数据。
 *
 * Session 始终归 Agent 所有。来源拆成两层，各自承担不同职责：
 *
 * - `category` 是顶层分类，只有 `chat` 与 `work` 两个值，用于目录过滤及请求一致性校验。
 *   Agent 的活动与归档 Session 共享单库，分类不扩大身份命名空间。
 * - `type` 表达具体业务用途；通用角色在此登记，Power 自有角色由对应 Power
 *   定义并显式声明分类。角色名称不授予工具或执行配置。
 *
 * 关键点（中文）
 * - `chat` 类是对话会话：Agent 主对话、外部聊天、群聊、浏览器扩展。
 * - `work` 类是干活会话：普通工作会话、任务会话。
 * - `session_id` 是永久唯一 UUID，Agent 是其拥有者与权限路由。
 * - Agent 主会话通过持久指针定位；归档不改变身份，重建主会话分配新 UUID。
 */



/** 对话类分类：与用户或外部渠道对话的会话。 */
export const SESSION_ORIGIN_CATEGORY_CHAT = "chat";

/** 干活类分类：执行具体工作的会话。 */
export const SESSION_ORIGIN_CATEGORY_WORK = "work";

/** Agent 自己那条会话的角色。 */
export const SESSION_ORIGIN_TYPE_AGENT = "agent";

/** 每个外部聊天独有、归绑定 Agent 所有的会话角色。 */
export const SESSION_ORIGIN_TYPE_CHANNEL = "channel";

/** 群聊成员会话的角色。 */
export const SESSION_ORIGIN_TYPE_GROUP = "group";

/** 浏览器扩展会话的角色。 */
export const SESSION_ORIGIN_TYPE_CHROME = "chrome";

/** 普通工作会话的角色，也是未指定角色时的默认值。 */
export const SESSION_ORIGIN_TYPE_WORK = "work";

/** 任务会话的角色。 */
export const SESSION_ORIGIN_TYPE_TASK = "task";

/**
 * 派发深度上限。
 *
 * Chat 根会话深度为 0，一级 Work 为 1，二级 Work 为 2。
 * 达到上限的会话不能再创建，但始终可读取会话历史。
 */
export const SESSION_DELEGATION_MAX_DEPTH = 2;

/** 顶层分类的封闭取值。 */




/**
 * 已知角色到分类的映射。
 *
 * 这是「角色归属哪个分类」的唯一权威来源；调用方自定义角色不受此表约束，
 * 但必须在创建时显式给出 `category`。
 */
const ORIGIN_CATEGORY_BY_TYPE                                                  = Object.freeze({
  [SESSION_ORIGIN_TYPE_AGENT]: SESSION_ORIGIN_CATEGORY_CHAT,
  [SESSION_ORIGIN_TYPE_CHANNEL]: SESSION_ORIGIN_CATEGORY_CHAT,
  [SESSION_ORIGIN_TYPE_GROUP]: SESSION_ORIGIN_CATEGORY_CHAT,
  [SESSION_ORIGIN_TYPE_CHROME]: SESSION_ORIGIN_CATEGORY_CHAT,
  [SESSION_ORIGIN_TYPE_WORK]: SESSION_ORIGIN_CATEGORY_WORK,
  [SESSION_ORIGIN_TYPE_TASK]: SESSION_ORIGIN_CATEGORY_WORK,
});

/** Session 的创建来源。 */
























/** 规范化一个 Session 来源分类。 */
export function normalize_session_origin_category(input         )                        {
  const category = typeof input === "string" ? input.trim() : "";
  if (
    category === SESSION_ORIGIN_CATEGORY_CHAT
    || category === SESSION_ORIGIN_CATEGORY_WORK
  ) {
    return category;
  }
  throw new Error(
    `Session origin.category requires "${SESSION_ORIGIN_CATEGORY_CHAT}" or "${SESSION_ORIGIN_CATEGORY_WORK}"`,
  );
}

/** 规范化一个 Session 来源角色。 */
export function normalize_session_origin_type(input         )         {
  const origin_type = typeof input === "string" ? input.trim() : "";
  if (!origin_type) throw new Error("Session origin.type requires a non-empty string");
  return origin_type;
}

/** 返回已知角色所属的分类；未知角色返回 undefined。 */
export function resolve_origin_category(origin_type        )                                    {
  return ORIGIN_CATEGORY_BY_TYPE[normalize_session_origin_type(origin_type)];
}

/**
 * 解析来源分类：优先使用显式声明，缺省时按已知角色推断。
 *
 * 未知角色没有可推断的分类，直接失败并要求调用方显式传入，避免把自定义角色
 * 静默塞进某个分类。
 */
function resolve_origin_category_input(
  origin                           ,
  origin_type        ,
)                        {
  const declared = origin.category === undefined
    ? undefined
    : normalize_session_origin_category(origin.category);
  const inferred = ORIGIN_CATEGORY_BY_TYPE[origin_type];
  if (declared && inferred && declared !== inferred) {
    throw new Error(
      `Session origin.category "${declared}" does not match role "${origin_type}"`,
    );
  }
  const resolved = declared ?? inferred;
  if (!resolved) {
    throw new Error(
      `Session origin.type "${origin_type}" has no known category; pass origin.category explicitly`,
    );
  }
  return resolved;
}

/** 规范化创建输入；未指定来源时使用默认工作会话。 */
export function normalize_session_origin(input                )                {
  const source = input ?? {
    category: SESSION_ORIGIN_CATEGORY_WORK,
    type: SESSION_ORIGIN_TYPE_WORK,
  };
  let serialized         ;
  try {
    serialized = JSON.parse(JSON.stringify(source));
  } catch {
    throw new Error("Session origin must be a JSON object");
  }
  if (!serialized || typeof serialized !== "object" || Array.isArray(serialized)) {
    throw new Error("Session origin must be a JSON object");
  }
  const origin = serialized                             ;
  const origin_type = normalize_session_origin_type(origin.type);
  return {
    ...origin,
    category: resolve_origin_category_input(origin, origin_type),
    type: origin_type,
  };
}

/**
 * 读取一个来源的派发深度。
 *
 * 参数用索引签名而不是具体字段：来源在各包里有各自的镜像类型，
 * 它们共有的只是「可携带任意 JSON 字段」这一点。
 *
 * Chat 为 0；无委派关系的 Work 为 1，表示宿主创建的 Main。
 * 有委派关系却缺少深度，或显式值非法时返回 Infinity；Subwork 的固定深度为 2。
 * 该函数只服务于写操作；读取历史不依赖深度。
 */
export function read_session_delegation_depth(
  origin                                                 ,
)         {
  const depth = origin?.delegation_depth;
  if (depth === undefined && origin?.category === SESSION_ORIGIN_CATEGORY_CHAT) return 0;
  if (depth === undefined && origin?.category === SESSION_ORIGIN_CATEGORY_WORK
    && origin.parent_session_id === undefined
    && origin.parent_session_category === undefined && origin.parent_agent_id === undefined) return 1;
  return typeof depth === "number" && Number.isInteger(depth) && depth >= 0
    ? depth : Number.POSITIVE_INFINITY;
}

/**
 * 解析阻止派发的原因；可以派发时返回 null。
 *
 * Chat 创建 Main，普通 Work Main 创建 Child。
 * Task Session 负责当前运行，执行器与模拟评审器均不能继续委派。
 */
export function resolve_delegation_blocked_reason(
  origin                                                 ,
)                {
  if (origin?.type === SESSION_ORIGIN_TYPE_TASK) {
    return "Task Sessions must execute the current run directly and cannot delegate work";
  }
  const known_chat = origin?.category === SESSION_ORIGIN_CATEGORY_CHAT;
  const ordinary_work = origin?.category === SESSION_ORIGIN_CATEGORY_WORK;
  if (!known_chat && !ordinary_work) return "Session role cannot delegate work";
  if (known_chat && read_session_delegation_depth(origin) !== 0) return "Invalid Chat delegation depth";
  const depth = read_session_delegation_depth(origin);
  if (!Number.isFinite(depth)) return "session_relation_invalid: invalid or incomplete Work delegation metadata";
  if (depth >= SESSION_DELEGATION_MAX_DEPTH) {
    return `Session delegation depth limit reached (max ${SESSION_DELEGATION_MAX_DEPTH})`;
  }
  if (ordinary_work && depth !== 1) return "Invalid Work delegation depth; only first-level Work can create children";
  return null;
}

/**
 * 判断一个来源是否允许派发其他会话。
 *
 * 仅判断创建工作能力；读取历史与控制已有直接子会话分别授权。
 * Chat 和普通 Work Main 可以创建；Task Session 不分派，Work Child 达到上限。
 */
export function can_delegate_work(
  origin                                                 ,
)          {
  return resolve_delegation_blocked_reason(origin) === null;
}

/** 判断一个来源是否表示 Agent 自己的会话。 */
export function is_agent_session_origin(
  origin                               ,
)          {
  return String(origin?.type || "").trim() === SESSION_ORIGIN_TYPE_AGENT;
}

/** 恢复 Metadata，并校验来源 category 与调用方期望一致；category 不决定永久身份或物理位置。 */
export function restore_session_origin(
  input         ,
  expected_category        ,
)                {
  if (!input) throw new Error("Session metadata requires origin");
  const origin = normalize_session_origin(input                 );
  const normalized_expected = normalize_session_origin_category(expected_category);
  if (origin.category !== normalized_expected) {
    throw new Error(
      `Session origin "${origin.category}" does not match expected category "${normalized_expected}"`,
    );
  }
  return origin;
}
