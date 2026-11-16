/** 通知来源回归：初始化零目录 IO、查询按引用去重、只读与重建记录隔离。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NotificationPower } from '../bin/notification/NotificationPower.js';
import { LocalStorageProvider } from '@downcity/city';
import { CityNotifications } from '../../../city/bin/city/power/CityNotifications.js';
import { LocalGroupSessionStore } from '../../../agent/bin/group/storage/LocalGroupSessionStore.js';
import { resolve_notification_targets } from '../../../city/bin/city/power/CityNotificationSources.js';

const old_id = '00000000-0000-4000-8000-000000000001';
const new_id = '00000000-0000-4000-8000-000000000002';
const target = { kind: 'agent_session', agent_id: 'a0', category: 'work', origin_type: 'work', session_id: 's', storage_id: old_id };

/** 只给被引用的 Agent 返回精确元数据；所有列表入口一旦访问即失败。 */
function fixture(context, agent_count = 10) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'downcity-notification-source-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scope = new LocalStorageProvider(root).open_scope(['notification']);
  const counts = { resolve: 0, metadata: 0, list: 0, interaction: 0 };
  const calls = [];
  let title = '原会话';
  let archived = false;
  let removed = false;
  let offline = false;
  const listeners = [];
  const noop_subscribe = () => () => {};
  const agents = Array.from({ length: agent_count }, (_, index) => ({
    id: `a${index}`, name: `Agent ${index}`, interactions: { subscribe: noop_subscribe },
    sessions: {
      on_created: listener => { listeners.push(listener); return () => {}; },
      on_removed: noop_subscribe, on_directory_changed: noop_subscribe,
      list: () => { counts.list++; throw new Error('must not enumerate'); },
      archived: () => { counts.list++; throw new Error('must not enumerate'); },
      read_metadata: async addresses => {
        counts.metadata++; calls.push({ agent_id: `a${index}`, addresses });
        if (offline) throw new Error('offline');
        return addresses.map(address => removed ? null : { storage_id: address.storage_id ?? new_id,
          archived: address.storage_id === old_id && archived,
          metadata: { title: address.storage_id === old_id ? title : '新会话', session_id: address.session_id, origin: { category: address.category, type: 'work' } } });
      },
    },
  }));
  const notifications = new CityNotifications();
  const actions = new Map();
  const power = new NotificationPower();
  const runtime_context = {
    storage: { path: scope.root_path, files: scope.files }, logger: { warn() {} },
    power: { action: action => actions.set(action.id, action) },
    system: {
      register_notification_receiver: receiver => notifications.register(receiver, agents),
      list_agents: async () => agents.map(agent => ({ agent_id: agent.id, name: agent.name })),
      list_agent_interactions: async () => { counts.interaction++; return []; },
      resolve_notification_targets: async targets => { counts.resolve++; return await resolve_notification_targets(targets, agents, [], []); },
    },
  };
  context.after(() => power.dispose());
  const commit = async event_id => power.hooks.effect['session.turn_committed'][0]({
    context: { agent: { id: 'a0' }, snapshot: { session_origin: { category: 'work', type: 'work', delegation_depth: 1 } } },
    value: { storage_id: old_id, completion_id: event_id, session_id: 's', status: 'completed', result: { text: '结果' } },
  });
  return { power, actions, counts, calls, listeners, runtime_context, commit,
    saved_path: path.join(scope.root_path, 'notifications.json'),
    set_title: value => { title = value; notifications.targets_changed(); },
    set_archived: value => { archived = value; notifications.targets_changed(); },
    set_removed: value => { removed = value; notifications.targets_changed(); },
    set_offline: value => { offline = value; notifications.targets_changed(); },
  };
}

test('10 个 Agent 初始化和会话创建只失效快照，不查询目录或创建通知文件', async context => {
  const f = fixture(context);
  await f.power.initialize(f.runtime_context);
  assert.deepEqual(f.counts, { resolve: 0, metadata: 0, list: 0, interaction: 0 });
  for (const listener of f.listeners) assert.equal(listener(), undefined);
  assert.deepEqual(f.counts, { resolve: 0, metadata: 0, list: 0, interaction: 0 });
  assert(!fs.existsSync(f.saved_path));
  const empty = await f.actions.get('notification.list').run();
  assert.deepEqual(empty.items, []);
  assert.equal(f.counts.metadata, 0);
  assert.equal(f.counts.resolve, 0);
  assert(!fs.existsSync(f.saved_path));
});

test('通知只查引用的原记录；改名/归档/断连/恢复不写文件，重投不恢复未读', async context => {
  const f = fixture(context);
  await f.power.initialize(f.runtime_context);
  await f.commit('turn-1');
  const persisted = JSON.parse(fs.readFileSync(f.saved_path, 'utf8'));
  assert(!('availability' in persisted[0]));
  assert.equal(persisted[0].target.storage_id, old_id);
  const first = await f.actions.get('notification.list').run();
  assert(f.calls.every(call => call.agent_id === 'a0' && call.addresses.every(address => address.storage_id === old_id)));
  assert.equal(f.counts.list, 0);
  await f.power.observe_view('window', target);
  const read = await f.actions.get('notification.list').run();
  assert.equal(read.items[0].read, true);
  const saved = fs.readFileSync(f.saved_path, 'utf8');
  const mtime = fs.statSync(f.saved_path).mtimeMs;
  f.set_title('改名');
  const renamed = await f.actions.get('notification.list').run();
  assert.equal(renamed.items[0].title, '改名');
  assert.equal(renamed.items[0].created_at, first.items[0].created_at);
  assert.equal(fs.readFileSync(f.saved_path, 'utf8'), saved);
  assert.equal(fs.statSync(f.saved_path).mtimeMs, mtime);
  await f.commit('turn-1');
  assert.equal(fs.readFileSync(f.saved_path, 'utf8'), saved);
  f.set_archived(true);
  await f.power.observe_view('window', { ...target, storage_id: new_id });
  assert.equal((await f.actions.get('notification.list').run()).items[0].availability, 'archived');
  f.set_offline(true);
  const offline = await f.actions.get('notification.list').run();
  assert.equal(offline.items[0].availability, 'unknown');
  assert.equal(offline.items[0].title, '原会话');
  f.set_offline(false);
  assert.equal((await f.actions.get('notification.list').run()).items[0].availability, 'archived');
  f.set_removed(true);
  assert.equal((await f.actions.get('notification.list').run()).items[0].availability, 'removed');
  assert.equal(fs.readFileSync(f.saved_path, 'utf8'), saved);
});

test('相同逻辑地址的新会话不会读取或标已读旧记录通知', async context => {
  const f = fixture(context, 1);
  await f.power.initialize(f.runtime_context);
  await f.commit('turn-1');
  f.set_archived(true);
  await f.power.observe_view('window', { ...target, storage_id: new_id });
  const old = await f.actions.get('notification.list').run();
  assert.equal(old.items[0].read, false);
  assert.equal(old.items[0].availability, 'archived');
  assert.equal(old.items[0].target.storage_id, old_id);
  const new_source = await f.runtime_context.system.resolve_notification_targets([{ ...target, storage_id: new_id }]);
  assert.equal(new_source[0].availability, 'available');
  assert.equal(new_source[0].title, '新会话');
});

test('只读解析批量分块、有界并发；一个主体失败不阻断其他来源', async () => {
  let active = 0; let peak = 0;
  const batches = [];
  const agents = ['a', 'b', 'offline'].map(id => ({ id, sessions: { read_metadata: async addresses => {
    batches.push([id, addresses.length]); active++; peak = Math.max(active, peak);
    try {
      await new Promise(resolve => setImmediate(resolve));
      if (id === 'offline') throw new Error('offline');
      return addresses.map(address => ({ storage_id: old_id, archived: false, metadata: { title: address.session_id } }));
    } finally { active--; }
  } } }));
  const targets = Array.from({ length: 205 }, (_, index) => ({ ...target, agent_id: 'a', session_id: `${index}` }));
  targets.push({ ...target, agent_id: 'b' }, { ...target, agent_id: 'offline' }, { ...target, agent_id: 'removed' });
  const resolved = await resolve_notification_targets(targets, agents, [], []);
  assert.deepEqual(batches.filter(([id]) => id === 'a').map(([, size]) => size), [100, 100, 5]);
  assert(peak <= 2);
  assert.equal(resolved[205].availability, 'available');
  assert.equal(resolved[206].availability, 'unknown');
  assert.equal(resolved[207].availability, 'removed');
});

test('多个通知和原 Interaction 引用同一记录时只解析一次', async context => {
  const f = fixture(context, 1);
  await f.power.initialize(f.runtime_context);
  await f.commit('turn-1');
  f.runtime_context.system.list_agent_interactions = async () => [{ storage_id: old_id, origin: { category: 'work', type: 'work' },
    reference: { session_category: 'work', session_id: 's', turn_id: 't', interaction_id: 'i' }, can_respond: true,
    interaction: { status: 'pending', request: { title: '问题', created_at: 1 } } }];
  f.counts.resolve = 0; f.counts.metadata = 0; f.calls.length = 0;
  const snapshot = await f.actions.get('notification.list').run();
  assert.equal(snapshot.items.length, 1); assert.equal(snapshot.interactions.length, 1);
  assert.equal(snapshot.pending_request_count, 1);
  assert.equal(f.counts.resolve, 1); assert.equal(f.counts.metadata, 1);
  assert.equal(f.calls[0].addresses.length, 1);
});

test('Group 来源精确只读：归档可识别，缺失/损坏不会创建锁或修复元数据', async context => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'downcity-notification-group-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const scope = new LocalStorageProvider(directory).open_scope(['group']);
  const store = new LocalGroupSessionStore({ group_id: 'g', files: scope.files, storage_root_path: scope.root_path });
  const metadata = { v: 2, group_id: 'g', session_id: 's', title: '群聊', created_at: 1, updated_at: 1, message_count: 0 };
  const active = path.join(scope.root_path, 'sessions', 's');
  fs.mkdirSync(active, { recursive: true });
  fs.writeFileSync(path.join(active, 'meta.json'), JSON.stringify(metadata));
  const groups = [{ id: 'g', get_session_store: () => store }];
  const reference = { kind: 'group_session', group_id: 'g', session_id: 's' };
  const read = async () => (await resolve_notification_targets([reference], [], groups, []))[0];
  const before = fs.readFileSync(path.join(active, 'meta.json'), 'utf8');
  assert.equal((await read()).title, '群聊');
  assert.equal((await read()).availability, 'available');
  assert.deepEqual(fs.readdirSync(active), ['meta.json']);
  assert.equal(fs.readFileSync(path.join(active, 'meta.json'), 'utf8'), before);
  fs.mkdirSync(path.join(scope.root_path, 'archived-sessions'), { recursive: true });
  const archived = path.join(scope.root_path, 'archived-sessions', 's');
  fs.renameSync(active, archived);
  assert.equal((await read()).availability, 'archived');
  fs.writeFileSync(path.join(archived, 'meta.json'), '{broken');
  assert.equal((await read()).availability, 'unknown');
  assert.equal(fs.readFileSync(path.join(archived, 'meta.json'), 'utf8'), '{broken');
  fs.rmSync(archived, { recursive: true });
  assert.equal((await read()).availability, 'removed');
  assert(!fs.existsSync(active));
});

test('普通通知缺失原记录身份时保留摘要，不能猜测重建后的活动来源', async context => {
  const f = fixture(context, 1);
  await f.power.initialize(f.runtime_context);
  await f.commit('turn-1');
  const records = JSON.parse(fs.readFileSync(f.saved_path, 'utf8'));
  delete records[0].target.storage_id;
  fs.writeFileSync(f.saved_path, JSON.stringify(records));
  f.calls.length = 0; f.counts.resolve = 0;
  const snapshot = await f.actions.get('notification.list').run();
  assert.equal(snapshot.items[0].availability, 'unknown');
  assert.equal(snapshot.items[0].title, '原会话');
  assert.equal(snapshot.items[0].target.storage_id, undefined);
  assert.equal(f.counts.resolve, 0);
});
