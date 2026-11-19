/** Session 完成与委派日志的离线迁移。原件和暂存件全部校验后发布，批次支持中断续跑与回滚。 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { AgentSessionFileLease } from "../packages/agent/bin/session/storage/agent-db/AgentSessionFileLease.js";
import { LocalFileSystem } from "../packages/city/bin/workspace/LocalFileSystem.js";
import { RootLease, resolve_resource_root } from "../packages/city/bin/local/resources/RootLease.js";
import { parse_arguments } from "./migrate-session-sqlite-v12.mjs";
import { convert_journal, with_session_catalog } from "./lib/session-descriptor-journal-conversion.mjs";
import { copy_verified_file, diagnostic, exists, file_hash, inside, ordinary, save_json, sync_path } from "./lib/session-v8-files.mjs";
import { fail } from "./lib/session-v7-database.mjs";

const help = `Session 完成与委派记录离线迁移（先构建 Agent、Type 和 City，并迁移 sessions.db）
node scripts/migrate-session-journals.mjs --preflight|--apply|--verify|--status|--restore
  --root PATH          显式指定数据目录
  --batch PATH         apply 使用数据目录外的新目录，续跑、验证和恢复使用同一批次
  --writers-stopped    apply 和 restore 必需，调用前退出全部宿主和写进程
  --help               显示帮助
尚未开始、无结果且无法绑定原执行的旧委派将转为停止并取消回传，其余待处理缺失身份的委派阻止迁移。`;

const file_id_pattern = /^[a-f0-9]{64}$/u;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const local_files = root_path => new LocalFileSystem({ root_path, file_mode: 0o600, directory_mode: 0o700 });

/** 只枚举运行时会读取的日志快照，保留取消标记、锁和其他 Agent 文件。 */
function discover(root_path) {
  const agents_path = path.join(root_path, "agents");
  const agents = [], records = [];
  if (!exists(agents_path)) return { agents, records };
  ordinary(agents_path, true);
  for (const agent_id of fs.readdirSync(agents_path).sort()) {
    const agent_path = path.join(agents_path, agent_id);
    ordinary(agent_path, true);
    const database_path = path.join(agent_path, "sessions.db");
    if (exists(database_path)) agents.push({ agent_id, database_path });
    for (const kind of ["completions", "delegations"]) {
      const directory = path.join(agent_path, kind);
      if (!exists(directory)) continue;
      ordinary(directory, true);
      for (const name of fs.readdirSync(directory).sort()) {
        if (!name.endsWith(".json") || !file_id_pattern.test(name.slice(0, -5))) continue;
        const relative_path = path.join("agents", agent_id, kind, name);
        ordinary(inside(root_path, relative_path));
        records.push({ relative_path, agent_id, kind, file_id: name.slice(0, -5) });
      }
    }
  }
  return { agents, records };
}

/** 逐条生成源和目标摘要，确保准备阶段所得的投影与预检计划一致。 */
async function plan(root_path, records) {
  return await with_session_catalog(root_path, read_session => records.map(scope => {
    const source = fs.readFileSync(inside(root_path, scope.relative_path));
    const { content, state, stopped } = convert_journal(source, scope, read_session);
    const source_hash = hash(source);
    return { relative_path: scope.relative_path, kind: scope.kind, state, stopped,
      source_hash, target_hash: content === source ? source_hash : hash(content) };
  }));
}

/** 批次必须属于同一个根，并覆盖当前全部记录；拒绝外部写入新增或删除的记录。 */
function read_manifest(root_path, batch_path, records) {
  ordinary(batch_path, true);
  const manifest_path = path.join(batch_path, "manifest.json");
  ordinary(manifest_path);
  const manifest = JSON.parse(fs.readFileSync(manifest_path, "utf8"));
  if (manifest.version !== 1 || manifest.root_path !== root_path || !Array.isArray(manifest.records)
    || manifest.records.length !== records.length || manifest.records.some((item, index) =>
      item.relative_path !== records[index].relative_path || item.kind !== records[index].kind
      || !file_id_pattern.test(item.source_hash) || !file_id_pattern.test(item.target_hash))) fail("journal_manifest_scope_changed");
  return manifest;
}

/** 生成和验证所有备份及暂存件，此阶段不会覆盖任何源快照。 */
async function stage(root_path, batch_path, manifest, records) {
  const files = local_files(batch_path);
  const directories = new Set();
  await with_session_catalog(root_path, async read_session => {
    for (const [index, item] of manifest.records.entries()) {
      if (item.source_hash === item.target_hash) continue;
      const source = inside(root_path, item.relative_path);
      const original = inside(batch_path, path.join("original", item.relative_path));
      fs.mkdirSync(path.dirname(original), { recursive: true, mode: 0o700 });
      copy_verified_file(source, original, item.source_hash, path.join(batch_path, ".copies"));
      const staged = path.join("staged", item.relative_path);
      const target = inside(batch_path, staged);
      if (!exists(target)) {
        const { content } = convert_journal(fs.readFileSync(original), records[index], read_session);
        if (hash(content) !== item.target_hash) fail("journal_conversion_plan_changed");
        await files.write_file_atomically(staged, content);
      }
      if (file_hash(target) !== item.target_hash) fail("journal_staged_changed");
      for (const file_path of [original, target]) {
        for (let directory = path.dirname(file_path); directory !== batch_path; directory = path.dirname(directory)) {
          directories.add(directory);
        }
      }
    }
  });
  for (const directory of [...directories].sort((left, right) => right.length - left.length)) sync_path(directory);
}

/** 完整批次核验允许明确的中断状态，恢复前拒绝任意后续写入。 */
function verify(root_path, batch_path, manifest, expected_side, verify_copies = true) {
  for (const item of manifest.records) {
    const current = file_hash(inside(root_path, item.relative_path));
    const expected = expected_side === "either" ? [item.source_hash, item.target_hash] : [item[`${expected_side}_hash`]];
    if (!expected.includes(current)) fail("journal_live_changed_or_business_write");
    if (!verify_copies || item.source_hash === item.target_hash) continue;
    for (const [directory, expected] of [["original", item.source_hash], ["staged", item.target_hash]]) {
      if (file_hash(inside(batch_path, path.join(directory, item.relative_path))) !== expected) fail("journal_batch_copy_changed");
    }
  }
}

/** 与正常运行时共用日志锁和原子文件提交，崩溃后允许由源或目标任一侧重入。 */
async function publish(root_path, batch_path, manifest, directory) {
  const target_key = directory === "staged" ? "target_hash" : "source_hash";
  const prior_key = directory === "staged" ? "source_hash" : "target_hash";
  const agents = new Map();
  const directories = new Set();
  for (const item of manifest.records) {
    if (item.source_hash === item.target_hash) continue;
    const [, agent_id, ...segments] = item.relative_path.split(path.sep);
    const agent_file = path.join(...segments);
    if (!agents.has(agent_id)) agents.set(agent_id, local_files(inside(root_path, path.join("agents", agent_id))));
    const files = agents.get(agent_id);
    const target = inside(root_path, item.relative_path);
    directories.add(path.dirname(target));
    await files.with_file_lock(`${agent_file}.lock`, async () => {
      const current = file_hash(target);
      if (current === item[target_key]) return;
      if (current !== item[prior_key]) fail("journal_live_changed_or_business_write");
      const content = fs.readFileSync(inside(batch_path, path.join(directory, item.relative_path)));
      if (hash(content) !== item[target_key]) fail("journal_batch_copy_changed");
      await files.write_file_atomically(agent_file, content);
    });
  }
  for (const directory of directories) sync_path(directory);
}

/** 独占根及相关 Session 库，批次阶段在任何一次发布或恢复前先耐久落盘。 */
async function run(input, root_path, batch_path) {
  const write = ["apply", "restore"].includes(input.mode);
  const lease = write ? RootLease.acquire_write(root_path) : null;
  const agent_leases = [];
  try {
    const { agents, records } = discover(root_path);
    if (input.mode === "preflight") return { status: "preflight", records: await plan(root_path, records) };
    const manifest_path = path.join(batch_path, "manifest.json");
    for (const { database_path, agent_id } of write ? agents : []) {
      agent_leases.push(AgentSessionFileLease.acquire(database_path, agent_id, true, true));
    }
    if (input.mode === "apply" && !exists(batch_path)) {
      const manifest = { version: 1, root_path, status: "planned", records: await plan(root_path, records) };
      fs.mkdirSync(batch_path, { mode: 0o700 });
      save_json(manifest_path, manifest);
      sync_path(path.dirname(batch_path));
    }
    const manifest = read_manifest(root_path, batch_path, records);
    const set_status = status => { manifest.status = status; save_json(manifest_path, manifest, true); };
    if (input.mode === "status") return manifest;
    if (input.mode === "verify" || (input.mode === "apply" && manifest.status === "ready")) {
      if (manifest.status !== "ready") fail("journal_batch_not_ready");
      verify(root_path, batch_path, manifest, "target");
      const current = await plan(root_path, records);
      if (current.some(item => item.source_hash !== item.target_hash)) fail("journal_conversion_incomplete");
      return manifest;
    }
    if (input.mode === "apply") {
      if (!["planned", "publishing"].includes(manifest.status)) fail("journal_batch_not_applicable");
      if (manifest.status === "planned") {
        verify(root_path, batch_path, manifest, "source", false);
        await stage(root_path, batch_path, manifest, records);
      }
      verify(root_path, batch_path, manifest, "either");
      set_status("publishing");
      await publish(root_path, batch_path, manifest, "staged");
      verify(root_path, batch_path, manifest, "target");
      set_status("ready");
      return manifest;
    }
    if (!["ready", "publishing", "restoring", "restored"].includes(manifest.status)) fail("journal_batch_not_restorable");
    verify(root_path, batch_path, manifest, manifest.status === "ready" ? "target" : manifest.status === "restored" ? "source" : "either");
    if (manifest.status === "restored") return manifest;
    set_status("restoring");
    await publish(root_path, batch_path, manifest, "original");
    verify(root_path, batch_path, manifest, "source");
    set_status("restored");
    return manifest;
  } finally {
    for (const agent_lease of agent_leases.reverse()) agent_lease.release();
    lease?.release();
  }
}

try {
  const input = parse_arguments(process.argv.slice(2));
  if (input.help) console.log(help);
  else {
    const root_path = fs.realpathSync(input.root_path);
    const batch_path = input.batch_path && resolve_resource_root(input.batch_path);
    if (batch_path) {
      const relative = path.relative(root_path, batch_path);
      if (relative !== ".." && !relative.startsWith(`..${path.sep}`)) fail("backup_must_be_outside_data_root");
    }
    const { status, records } = await run(input, root_path, batch_path);
    const counts = {};
    for (const { kind, state, stopped, source_hash, target_hash } of records) {
      const group = counts[kind] ??= { total: 0, converted: 0, stopped: 0, states: {} };
      group.total++;
      group.converted += Number(source_hash !== target_hash);
      group.stopped += Number(stopped);
      group.states[state] = (group.states[state] ?? 0) + 1;
    }
    console.log(JSON.stringify({ status, batch_path, ...counts }));
  }
} catch (error) {
  console.error(JSON.stringify({ status: "failed", reason: diagnostic(error) }));
  process.exitCode = 1;
}
