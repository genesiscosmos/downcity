/**
 * 存储 Worker 与内存拥有者共用的固定命令执行入口。
 * 保持内存/文件数据库相同的事务和身份语义，不在这里创建执行器或加载模型。
 */
import type { AgentSessionReadCommand, AgentSessionWriteCommand } from "@/types/store/AgentSessionWorker.js";
import { AgentArchivePlans } from "./AgentArchivePlan.js";
import { AgentSessionDatabase } from "./AgentSessionDatabase.js";
import { AgentSessionCatalog } from "./AgentSessionCatalog.js";
import { AgentSessionMessages } from "./AgentSessionMessages.js";
import { AgentSessionConfiguration } from "./AgentSessionConfiguration.js";
import { read_session_input_versions } from "./AgentSessionInputVersions.js";

/** Writer 命令集合用于 Reader 防线，不能依赖 TypeScript 在运行时阻止写入。 */
export function is_agent_session_write_command(operation: AgentSessionReadCommand | AgentSessionWriteCommand): boolean {
  return ["ensure_creation", "ensure_main", "create", "archive", "remove", "append", "update", "truncate", "configure", "checkpoint_insert", "archive_prepare", "archive_node"].includes(operation.command);
}

/** 分发单个语义命令；所有数据库工作同步结束后返回。 */
export function execute_agent_session_command(owner: AgentSessionDatabase, operation: AgentSessionReadCommand | AgentSessionWriteCommand): unknown {
  const catalog = new AgentSessionCatalog(owner);
  const messages = new AgentSessionMessages(owner);
  const configuration = new AgentSessionConfiguration(owner);
  switch (operation.command) {
    case "ensure_creation": return catalog.ensure_creation(operation.operation_id, operation.input);
    case "main": return catalog.main();
    case "ensure_main": return catalog.ensure_main(operation.operation_id, operation.input);
    case "archive_plan": return new AgentArchivePlans(owner).read(operation.operation_id);
    case "archive_prepare": {
      new AgentArchivePlans(owner).prepare(operation.input);
      return { operation_id: operation.input.operation_id };
    }
    case "archive_node": {
      new AgentArchivePlans(owner).commit(operation.input);
      return { operation_id: operation.input.operation_id, position: operation.input.position };
    }
    case "categories": return owner.read(database => database.prepare("SELECT DISTINCT category FROM sessions WHERE archived = ? ORDER BY category")
      .all(operation.archived ? 1 : 0).map(row => String(row.category)));
    case "first_user": return messages.first_user(operation.session_id);
    case "latest_agent": return messages.latest_agent(operation.session_id, operation.turn_id);
    case "message_stats": {
      const page = messages.page(operation.session_id, { limit: 1 });
      const page_count = Number(owner.database.prepare("PRAGMA page_count").get()?.page_count ?? 0);
      const page_size = Number(owner.database.prepare("PRAGMA page_size").get()?.page_size ?? 0);
      return { message_count: page.total, latest_message: page.items.at(-1) ?? null,
        storage_bytes: owner.options.database_path === ":memory:" ? 0 : page_count * page_size };
    }
    case "pending_records": return owner.read(database => database.prepare(`SELECT * FROM sessions WHERE archived = 0
      AND EXISTS (SELECT 1 FROM messages WHERE messages.session_key = sessions.session_key AND role = 'agent' AND state = 'streaming')`).all());
    case "archived_records": return owner.read(database => database.prepare("SELECT * FROM sessions WHERE archived = 1").all());
    case "configure": return configuration.update(operation.input);
    case "checkpoint_insert": return configuration.insert_checkpoint(operation.input);
    case "checkpoint": return configuration.checkpoint(operation.session_id, operation.namespace, operation.schema_version);
    case "metadata": return owner.read(database => {
      if (operation.addresses.length > 100) throw new Error("session_metadata_limit_invalid");
      const by_record = database.prepare("SELECT * FROM sessions WHERE session_id = ? AND category = ?");
      return operation.addresses.map(address => by_record.get(address.session_id, address.category) ?? null);
    });
    case "list": return catalog.list(operation.input);
    case "find": return catalog.find(operation.address);
    case "record": return catalog.by_session_id(operation.session_id);
    case "configuration": return catalog.configuration(operation.session_id);
    case "recoverable": return messages.recoverable(operation.session_id);
    case "input_versions": return read_session_input_versions(owner, operation.session_id);
    case "messages": return messages.page(operation.session_id, operation.input);
    case "message": return messages.message(operation.session_id, operation.id);
    case "part_message": return messages.part_message(operation.session_id, operation.id);
    case "inbox_message": return messages.inbox_message(operation.session_id, operation.id);
    case "has_attachment": return messages.has_attachment(operation.session_id, operation.file_path);
    case "receipt": return owner.receipt(operation.operation_id);
    case "create": return catalog.create(operation.operation_id, operation.input);
    case "archive": return catalog.archive(operation.operation_id, operation.address, operation.archived_at);
    case "remove": return catalog.remove(operation.operation_id, operation.address);
    case "append": return messages.append(operation.input);
    case "update": return messages.update(operation.input);
    case "truncate": return messages.truncate(operation.input);
    default: throw new Error("session_storage_command_invalid");
  }
}

