/** 隔离验收：整段审批、公开对象、跨 Agent profile 修订、秘密边界和执行生命周期；不连接运行中的 City。 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { Agent } from '@downcity/agent';
import { AgentRepository } from '../bin/local/repositories/AgentRepository.js';
import { AgentResources } from '../bin/local/resources/AgentResources.js';
import { ResourceCoordinator } from '../bin/local/resources/ResourceCoordinator.js';
import { create_agent_profiles } from '../bin/application/AgentProfiles.js';
import { PublicApplication } from '../bin/application/PublicApplication.js';
import { create_core_objects } from '../bin/application/CoreObjects.js';
import { RuntimeService } from '../bin/city/power/builtin/runtime/RuntimeService.js';
import { ContextPower } from '../bin/city/power/builtin/ContextPower.js';
import { SessionRuntimePool } from '../bin/city/power/builtin/runtime/SessionRuntimePool.js';
import { execute_power_action } from '../bin/power/core/PowerActionExecution.js';
import { ApprovalInteraction } from '../../agent/bin/session/messages/ApprovalInteraction.js';

const root_path = await fs.mkdtemp(path.join(os.tmpdir(), 'downcity-public-objects-'));
let runtime;
const agents = new AgentRepository(root_path);
const target = new Agent({ id: 'fixture_poet', name: 'Fixture Poet' });
let invalidations = 0;
let approvals = 0;
let decision = 'approve';
let expected_code = '';
let live = true;
let pending_approval;
let unblock_slow;
let slow_started;
const interactions = {
  redact_secret_values: value => value,
  resolve_secret_references: value => value,
  request: async () => { throw new Error('Unexpected direct interaction'); },
  approval: { request: async input => {
    approvals++;
    assert.equal(input.require_user, true);
    assert.equal(input.payload.validated_input.code, expected_code);
    // 展示快照不能替换待执行代码。
    input.payload.validated_input.code = 'return "tampered";';
    if (decision === 'wait') return await new Promise(resolve => { pending_approval = resolve; });
    return { approved: decision !== 'deny', auto_approved: decision === 'auto' };
  } },
};
const context = { agent: { id: 'fixture_caller' }, session: { id: 'fixture_session', type: 'chat' }, turn: { id: 'fixture_turn' }, call: { tool_call_id: 'fixture_call', interactions }, logger: { info: async () => undefined } };
const guard = (call, agent_id) => {
  assert.equal(call.context.agent.id, 'fixture_caller');
  if (!live || agent_id === 'forbidden') throw new Error('permission_denied: fixture caller or target unavailable');
};
try {
  agents.create({ agent_id: 'fixture_poet', name: 'Fixture Poet', description: 'isolated', instruction: 'Initial fixture instruction' });
  agents.create({ agent_id: 'forbidden', name: 'Forbidden', description: '', instruction: 'Private fixture scope' });
  const resources = new AgentResources({ root_path, agents, coordinator: new ResourceCoordinator(), agent_references: async () => [], host: {
    city: { agents: { get: id => id === target.id ? target : null, list: () => [target] } },
    resolve_model: async () => undefined, invalidate: () => { invalidations++; },
  } });
  const fixture = { name: 'fixture', contract: z.object({
    echo: z.function({ input: [z.object({ value: z.string() }).strict()], output: z.string() }),
    added_method: z.function({ input: [z.object({}).strict()], output: z.string() }).describe('A new method on a mounted public object.'),
    slow: z.function({ input: [z.object({}).strict()], output: z.string() }),
  }), authorize: call => guard(call), bind: () => ({ echo: input => input.value, added_method: () => 'automatically bound', slow: async () => { slow_started?.(); return await new Promise(resolve => { unblock_slow = resolve; }); } }) };
  const objects = [...create_core_objects(Object.freeze({}), 'fixture'), create_agent_profiles(() => resources, guard), fixture];
  const application = new PublicApplication(objects);
  assert.match(application.declarations, /profile/);
  assert(application.help({ query: 'profile.update' }).symbols.length);
  runtime = new RuntimeService(objects, { authorize: (_symbol, _input, call) => guard(call) });
  const power = new ContextPower({ access: {}, files_for: () => { throw new Error('Unexpected private storage access'); } }, runtime);
  const action = power.actions.execute;
  const discover = async (payload = {}, overrides = {}) => await execute_power_action({
    power_name: 'context', action_name: 'help', action: power.actions.help, payload,
    site: { agent_id: context.agent.id, session_id: context.session.id, interactions },
    host: { context_for: (_name, site) => ({ ...context, abort_signal: site.abort_signal, ...overrides }) },
  });
  // 帮助不得进入池调度（其中才创建引擎），也不得触发脚本执行；只走正常 Power 只读流水线。
  const schedule = SessionRuntimePool.prototype.schedule;
  SessionRuntimePool.prototype.schedule = () => { throw new Error('Discovery attempted engine creation'); };
  const execute = runtime.execute;
  runtime.execute = () => { throw new Error('Discovery attempted guest execution'); };
  let root_help;
  try {
    assert.equal(power.actions.help.access, 'read');
    assert.equal(power.actions.help.approval, undefined);
    assert.match(power.system(), /context.help first/);
    root_help = await discover();
    assert.equal(root_help.success, true);
    assert.deepEqual(root_help.data.objects, [...objects.map(object => object.name), 'runtime']);
    assert.deepEqual((await discover({ query: 'added_method' })).data.symbols.map(item => item.symbol), ['fixture.added_method']);
    assert((await discover({ symbol: 'agents.get().profile' })).data.symbols.length > 0);
    assert.equal(root_help.data.symbols.length, 12);
    assert.equal(root_help.data.next_cursor, 12);
    assert.equal((await discover({ cursor: 12 })).data.next_cursor, null);
    assert.deepEqual((await discover({ cursor: 1000 })).data.symbols, []);
    for (const payload of [{ query: 'a', symbol: 'b' }, { cursor: -1 }, { cursor: 0.5 }, { cursor: '12' }, { query: 'x'.repeat(201) }, { symbol: 'x'.repeat(201) }, { code: 'return 1;' }, { agent_id: 'forbidden' }, null]) {
      assert.equal((await discover(payload)).success, false, JSON.stringify(payload));
    }
    assert.equal((await discover({ symbol: 'desktop' })).success, false);
    assert.equal((await discover({ symbol: 'fixture.constructor' })).success, false);
    assert.equal((await discover({}, { session: undefined })).success, false);
    live = false;
    assert.equal((await discover()).success, false);
    live = true;
    assert.equal((await discover({}, { session: { id: 'work_fixture', type: 'work' }, turn: undefined })).success, true);
    assert.equal((await discover({}, { session: { id: 'main_fixture', type: 'chat' }, workspace: undefined, turn: undefined })).success, true);
    assert.equal(approvals, 0);
  } finally {
    runtime.execute = execute;
    SessionRuntimePool.prototype.schedule = schedule;
    live = true;
  }
  console.log('PASS bare context.help: no approvals, script execution, engine scheduling or storage; root/query/symbol/pagination validation and live caller scope');
  const run = async (code, options = {}) => {
    expected_code = code;
    const site = { agent_id: context.agent.id, session_id: context.session.id, turn_id: context.turn.id, tool_call_id: context.call.tool_call_id, interactions, ...options.site };
    return await execute_power_action({ power_name: 'context', action_name: 'execute', action, payload: { code, timeout_ms: 5000, ...options.payload }, site,
      host: { context_for: (_name, actual_site) => ({ ...context, session: { ...context.session, id: actual_site.session_id }, abort_signal: actual_site.abort_signal }) } });
  };
  const value = result => { assert.equal(result.success, true, JSON.stringify(result)); return result.data.value; };
  decision = 'deny';
  assert.equal((await run('return await downcity.help();')).success, false);
  assert.equal(approvals, 1);
  assert.equal((await run('state.denied = true; return 1;')).success, false);
  decision = 'auto';
  assert.equal((await run('state.auto = true; return 1;')).success, false);
  decision = 'approve';
  assert.deepEqual(value(await run('return await downcity.help();')), root_help.data);
  assert.deepEqual(value(await run('return await downcity.help({symbol:"agents.get().profile"});')), (await discover({ symbol: 'agents.get().profile' })).data);
  assert.equal(value(await run('return state.denied ?? state.auto ?? null;')), null);
  assert.equal(value(await run('return await downcity.fixture.added_method();')), 'automatically bound');
  const invalid_runtime_input = await run('return await downcity.fixture.echo({value:42});', { payload: { language: 'javascript' } });
  assert.equal(invalid_runtime_input.success, false);
  assert.equal(invalid_runtime_input.data.calls[0].status, 'failed');
  assert.equal((await run('return 1;', { payload: { approved: true } })).success, false);
  console.log('PASS exact script approval, denial/auto-approval blocked, generated types/help/bindings, JS runtime validation');

  const before = approvals;
  const updated = value(await run(`const poet = await downcity.agents.get({agent_id:'fixture_poet'});
const profile = await poet.profile.get(); if (!profile.revision) throw Error('unregistered'); state.old_revision = profile.revision;
const result = await poet.profile.update({if_revision:profile.revision, name:'Updated Fixture Poet', instruction:'Updated fixture instruction'});
return {result, profile:await poet.profile.get(), directory:await downcity.agents.list({query:'Fixture'})};`));
  assert.equal(approvals - before, 1);
  assert.equal(updated.profile.instruction, 'Updated fixture instruction');
  assert.equal(updated.profile.name, target.name);
  assert.equal(updated.result.applied_revision, updated.profile.revision);
  assert.equal(updated.result.effective_scope, 'new_sessions');
  assert.equal(agents.get('fixture_poet').instruction, updated.profile.instruction);
  assert.equal(invalidations, 1);
  assert.equal((await run(`const poet = await downcity.agents.get({agent_id:'fixture_poet'}); return await poet.profile.update({if_revision:state.old_revision, name:'Conflict'});`)).success, false);
  assert.equal(agents.get('fixture_poet').name, 'Updated Fixture Poet');
  assert.equal((await run(`return await downcity.agents.get({agent_id:'forbidden'});`)).success, false);
  assert.equal((await run(`const poet = await downcity.agents.get({agent_id:'fixture_poet'}); return await poet.profile.update({if_revision:'x', env:{KEY:'secret'}});`)).success, false);
  const count = approvals;
  assert.equal((await run('return "' + '$' + '{secrets.fixture_key}";')).success, false);
  assert.equal(approvals, count);
  console.log('PASS isolated cross-Agent profile update, revision/runtime application/event invalidation, conflicts, permission/secret boundaries');

  value(await run('state.count = 42; state.old_client = downcity.fixture; return state.count;'));
  assert.equal(value(await run('return state.count;')), 42);
  assert.equal(value(await run('return state.count ?? null;', { site: { session_id: 'other_session' } })), null);
  const stale = await run('return await state.old_client.added_method();');
  assert.equal(stale.success, false);
  assert.match(stale.error, /expired execution binding/);
  const partial = await run(`const poet = await downcity.agents.get({agent_id:'fixture_poet'}); const profile = await poet.profile.get(); if (!profile.revision) throw Error('unregistered'); await poet.profile.update({if_revision:profile.revision, description:'Persisted before failure'}); throw Error('after persistence');`);
  assert.equal(partial.success, false);
  assert.equal(agents.get('fixture_poet').description, 'Persisted before failure');
  assert(partial.data.calls.some(call => call.status === 'completed'));
  value(await run(`state.old_agent = await downcity.agents.get({agent_id:'fixture_poet'}); return true;`));
  assert.equal((await run('return await state.old_agent.profile.get();')).success, false);
  const large = await run('return "x".repeat(10000);', { payload: { max_output_tokens: 256 } });
  assert(large.data.result_ref);
  const page = value(await run(`return await downcity.runtime.read_result({result_ref:'${large.data.result_ref}'});`));
  assert.equal(page.text.length, 4096); assert.equal(page.next_offset, 4096);
  assert.equal((await run(`return await downcity.runtime.read_result({result_ref:'${large.data.result_ref}'});`, { site: { session_id: 'other_session' } })).success, false);
  const invalid_help = await run('return await downcity.help({query:"x", symbol:"y"});');
  assert.equal(invalid_help.data.calls[0].status, 'failed');
  assert.equal(invalid_help.data.state_reset, false);
  console.log('PASS per-Session state/results, stale proxy rejection, partial effects/receipts and invalid help');

  decision = 'wait';
  const approval_abort = new AbortController();
  const waiting = run('state.cancelled_approval = true; return 1;', { site: { abort_signal: approval_abort.signal } });
  await new Promise(resolve => setImmediate(resolve)); approval_abort.abort();
  assert.equal((await waiting).success, false);
  pending_approval({ approved: true, auto_approved: false });
  decision = 'approve';
  assert.equal(value(await run('return state.cancelled_approval ?? null;')), null);
  const execution_abort = new AbortController();
  const started = new Promise(resolve => { slow_started = resolve; });
  const executing = run('return await downcity.fixture.slow();', { site: { abort_signal: execution_abort.signal } });
  await started; execution_abort.abort();
  const cancelled = await executing;
  assert.equal(cancelled.success, false);
  assert.equal(cancelled.data.status, 'cancelled');
  unblock_slow('settled after cancellation');
  await new Promise(resolve => setImmediate(resolve));
  const receipts = value(await run(`return await downcity.runtime.receipts({execution_id:'${cancelled.data.execution_id}'});`));
  assert(receipts.calls.some(call => call.status === 'completed'));
  const timeout = await run('while(true) {}', { payload: { timeout_ms: 100 } });
  assert.equal(timeout.success, false); assert.equal(timeout.data.status, 'timed_out');
  const recovered = await run('return state.count ?? null;');
  assert.equal(value(recovered), null); assert.equal(recovered.data.state_reset, true);
  live = false;
  assert.equal((await discover()).success, false);
  assert.equal((await run('return await downcity.help();')).success, false);
  assert.equal((await run('return await downcity.fixture.added_method();')).success, false);
  console.log('PASS cancellation before/during execution, late approvals, timeout/reset, caller lifecycle');

  let requested = 0;
  const approval = new ApprovalInteraction({ read_mode: () => 'always-allow', interactions: { request: async () => { requested++; return { interaction_id: 'fixture_approval', result: Promise.resolve({ status: 'resolved', response: { type: 'approval', outcome: 'resolved', payload: { decision: 'approved' } } }) }; } } });
  assert.equal((await approval.request({ require_user: true, turn_id: 'turn', tool_call_id: 'call', payload: { operation: 'tool', validated_input: { code: 'return 1;' } } })).auto_approved, false);
  assert.equal(requested, 1);
  console.log('PASS explicit user interaction even in always-allow mode');
} finally {
  unblock_slow?.('fixture cleanup');
  await runtime?.dispose();
  if (runtime) await assert.rejects(runtime.help({}, context), /host_unavailable/);
  await target.dispose();
  await fs.rm(root_path, { recursive: true, force: true });
}
