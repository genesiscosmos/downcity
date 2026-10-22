/**
 * Session 来源分类迁移：把单一 `origin.type` 拆成 `origin.category` + `origin.type`。
 *
 * 背景（中文）
 * - 旧模型里 `origin.type` 同时承担角色与物理分区两件事，取值有 agent / channel /
 *   group / chrome / task / work，以及更早的 chat。
 * - 新模型把它拆成两层：`category` 只有 chat / work 两个值，承担分区与身份作用域；
 *   `type` 保留具体角色。
 * - 因此历史数据需要同时改两处：数据库 `session_state.origin` 的 JSON，以及
 *   `sessions/<分区>/<session_id>/` 的目录位置。
 *
 * 关键点（中文）
 * - 真实角色以数据库 metadata 为准，不按目录名猜测：本机历史上存在
 *   `sessions/chat/`（`work` 改名前的遗留分区），按目录名映射会归错分类。
 * - 逐 Session 幂等：每迁移完一个会话即落盘；中途失败下一次重跑会跳过已完成项。
 * - 不做回滚。已改的 JSON 与已搬的目录可能不同步，回滚比继续往前跑更容易留下脏状态；
 *   失败时保留现场，由下次重跑收敛。
 * - 完成判据是存储根下的标记文件；标记存在即整体跳过，正常路径零成本。
 */
import { DatabaseSync } from "node:sqlite";
import type { FileSystem, SessionOrigin } from "@downcity/type";
import {
  SESSION_ORIGIN_CATEGORY_CHAT,
  SESSION_ORIGIN_CATEGORY_WORK,
  SESSION_ORIGIN_TYPE_AGENT,
  SESSION_ORIGIN_TYPE_CHANNEL,
  SESSION_ORIGIN_TYPE_CHROME,
  SESSION_ORIGIN_TYPE_GROUP,
  SESSION_ORIGIN_TYPE_TASK,
  SESSION_ORIGIN_TYPE_WORK,
} from "@downcity/type";

/** 迁移完成标记文件名，位于 Agent 存储根目录。 */
const MIGRATION_MARKER = ".origin-category-v1";

/**
 * 旧角色到新分类的映射。
 *
 * `chat` 是 `work` 取代前的默认角色，它们都是项目里的干活会话，因此归入 work 分类。
 * 未知角色归入 work：历史上只有这几个取值，出现未知值时保持可用比中断更合理。
 */
const LEGACY_CATEGORY_BY_TYPE: Readonly<Record<string, string>> = Object.freeze({
  [SESSION_ORIGIN_TYPE_AGENT]: SESSION_ORIGIN_CATEGORY_CHAT,
  [SESSION_ORIGIN_TYPE_CHANNEL]: SESSION_ORIGIN_CATEGORY_CHAT,
  [SESSION_ORIGIN_TYPE_GROUP]: SESSION_ORIGIN_CATEGORY_CHAT,
  [SESSION_ORIGIN_TYPE_CHROME]: SESSION_ORIGIN_CATEGORY_CHAT,
  [SESSION_ORIGIN_TYPE_WORK]: SESSION_ORIGIN_CATEGORY_WORK,
  [SESSION_ORIGIN_TYPE_TASK]: SESSION_ORIGIN_CATEGORY_WORK,
  // `chat` 是 work 之前的历史默认角色。
  chat: SESSION_ORIGIN_CATEGORY_WORK,
});

/** 迁移输入。 */
export interface OriginCategoryMigrationInput {
  /** 当前 Agent 的私有文件能力。 */
  files: FileSystem;
  /** 当前 Agent 的存储根目录绝对路径。 */
  storage_root_path: string;
}

/**
 * 幂等执行来源分类迁移。
 *
 * 返回是否真正执行了迁移动作；已迁移过时返回 false。
 */
export async function migrate_session_origin_categories(
  input: OriginCategoryMigrationInput,
): Promise<boolean> {
  const marker_path = `${input.storage_root_path}/${MIGRATION_MARKER}`;
  if (await input.files.path_exists(marker_path)) return false;
  await migrate_partition_root(input, "sessions");
  await migrate_partition_root(input, "archived-sessions");
  await input.files.write_file_atomically(marker_path, new Date().toISOString());
  return true;
}

/** 迁移一个分区根目录下的全部会话。 */
async function migrate_partition_root(
  input: OriginCategoryMigrationInput,
  partition_root_name: string,
): Promise<void> {
  const partition_root = `${input.storage_root_path}/${partition_root_name}`;
  if (!(await input.files.path_exists(partition_root))) return;
  for (const partition of await input.files.read_directory(partition_root)) {
    if (!partition.is_directory) continue;
    const legacy_partition = decode_partition_segment(partition.name);
    if (!legacy_partition) continue;
    const partition_path = `${partition_root}/${partition.name}`;
    for (const session of await input.files.read_directory(partition_path)) {
      if (!session.is_directory) continue;
      const session_id = decode_partition_segment(session.name);
      if (!session_id) continue;
      await migrate_one_session(input, {
        partition_root_name,
        legacy_partition,
        legacy_partition_segment: partition.name,
        storage_root_path: input.storage_root_path,
        session_id,
        session_segment: session.name,
      });
    }
    // 旧分区名不再被任何代码读取；清掉空壳目录，避免存储里留下无意义的分区。
    await remove_if_empty(input, partition_path);
  }
}

/** 删除空目录；目录里还有内容时保留，不影响未迁移完的会话。 */
async function remove_if_empty(
  input: OriginCategoryMigrationInput,
  directory_path: string,
): Promise<void> {
  const entries = await input.files.read_directory(directory_path).catch(() => undefined);
  if (!entries || entries.length > 0) return;
  await input.files.remove_path(directory_path).catch(() => undefined);
}

/** 迁移单个会话：先改数据库 origin，再搬到新分区目录。 */
async function migrate_one_session(
  input: OriginCategoryMigrationInput,
  target: {
    /** 顶层分区根名，`sessions` 或 `archived-sessions`。 */
    partition_root_name: string;
    /** 目录名解码出的旧分区名。 */
    legacy_partition: string;
    /** 目录名原文，搬迁时作为源路径片段。 */
    legacy_partition_segment: string;
    /** 存储根目录绝对路径。 */
    storage_root_path: string;
    /** 会话标识。 */
    session_id: string;
    /** 会话目录名原文，搬迁时作为源路径片段。 */
    session_segment: string;
  },
): Promise<void> {
  const source_dir = `${target.storage_root_path}`
    + `/${target.partition_root_name}/${target.legacy_partition_segment}/${target.session_segment}`;
  const database_path = `${source_dir}/session.db`;
  if (!(await input.files.path_exists(database_path))) return;
  const migrated = read_and_rewrite_origin(database_path);
  if (!migrated) return;
  const destination_partition = migrated.category;
  const destination_dir = `${target.storage_root_path}`
    + `/${target.partition_root_name}/${encode_partition_segment(destination_partition)}/${target.session_segment}`;
  if (destination_dir === source_dir) return;
  await input.files.ensure_directory(
    `${target.storage_root_path}/${target.partition_root_name}/${encode_partition_segment(destination_partition)}`,
  );
  await input.files.move_path(source_dir, destination_dir);
}

/**
 * 读库、改写 origin、写回。
 *
 * 返回新 origin 的分类；数据库缺失或没有状态行时返回 null，表示无需处理。
 * 单库失败不向上抛：一个坏会话不应阻塞整个 Agent 的迁移，下次重跑会再尝试。
 */
function read_and_rewrite_origin(
  database_path: string,
): { category: string } | null {
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(database_path);
    const row = database
      .prepare("SELECT origin FROM session_state WHERE singleton_id = 1")
      .get() as { origin?: unknown } | undefined;
    if (!row || typeof row.origin !== "string") return null;
    const origin = JSON.parse(row.origin) as Record<string, unknown>;
    const migrated = upgrade_origin(origin);
    if (migrated.already_migrated) return null;
    database
      .prepare("UPDATE session_state SET origin = ? WHERE singleton_id = 1")
      .run(JSON.stringify(migrated.origin));
    return { category: migrated.category };
  } catch {
    return null;
  } finally {
    try {
      database?.close();
    } catch {
      // 关闭失败不改变迁移结论。
    }
  }
}

/** 把旧 origin 升级为新结构；已含 category 时原样返回。 */
function upgrade_origin(origin: Record<string, unknown>): {
  /** 升级后的完整 origin。 */
  origin: SessionOrigin;
  /** 升级后的分类。 */
  category: string;
  /** 该 origin 是否本来就已符合新结构。 */
  already_migrated: boolean;
} {
  const origin_type = String(origin.type || "").trim() || SESSION_ORIGIN_TYPE_WORK;
  const declared_category = String(origin.category || "").trim();
  if (declared_category === SESSION_ORIGIN_CATEGORY_CHAT
    || declared_category === SESSION_ORIGIN_CATEGORY_WORK) {
    return {
      origin: origin as unknown as SessionOrigin,
      category: declared_category,
      already_migrated: true,
    };
  }
  const category = LEGACY_CATEGORY_BY_TYPE[origin_type] ?? SESSION_ORIGIN_CATEGORY_WORK;
  return {
    origin: { ...origin, category, type: origin_type } as unknown as SessionOrigin,
    category,
    already_migrated: false,
  };
}

/** 解码目录名中的分区标识；与 LocalStorePaths 的编码规则互逆。 */
function decode_partition_segment(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

/** 编码分区目录名；与 LocalStorePaths 的规则保持一致。 */
function encode_partition_segment(input: string): string {
  return [...Buffer.from(input, "utf8")]
    .map((byte) =>
      (byte >= 97 && byte <= 122)
      || (byte >= 48 && byte <= 57)
      || byte === 45
      || byte === 95
      || byte === 126
        ? String.fromCharCode(byte)
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`
    )
    .join("");
}
