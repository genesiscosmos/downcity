# Session private values in City Shell

Shell Power passes resolved input through to Shell. City does not expand references a second time or reject resolved Shell input because it happens to match a known secret. Reference resolution and protected command/path fields remain owned by the Agent.

## Required Session port

The originating `SessionInteractionPort` must expose this required method for Session-backed Shell execution:

```ts
create_secret_stream_redactor(): {
  write(chunk: string): string;
  end(): string;
}
```

The raw secret list stays inside the Agent. Each returned stream owns independent buffering and retained secret knowledge. It must:

- Capture current and old values at creation.
- Emit only a safe prefix on `write`; retain the suffix that could begin a secret, including matches spanning chunks. Retaining every chunk until EOF would prevent password prompts from being delivered.
- Absorb the Session's current/old values on every write, including `write("")`. The lookup must follow the current Session store because `SessionSecrets.with_values()` replaces that store.
- Retain captured values after Session clear/disposal, until stream end. Session clear should first seal the latest values into active streams so concurrent file writes/background output cannot lose newly submitted values before the next data event.
- Return the safely redacted remainder on `end`.

City calls `write("")` through both stages before stdin approval or `child.write(chars)`. This captures a password submitted after process startup before an echo can occur or the originating Session can clear.

A Session port without this factory is rejected before process startup with an explicit integration error. A final-value redactor cannot safely substitute for it: Session clear may happen while the process is still running. Non-Session Shell execution retains its ordinary behavior.

## Execution ownership and sinks

`ShellTools.resolve_shell_execution_context` carries a minimal redaction port on a City-local `PrivateShellExecutionContext.private_values`. The default runner forwards that object directly to `Shell.run_action`; `create_host_context` creates a new host context for that action. These local extensions require no extra `ToolCallContext` fields. A future public/shared Shell runner contract should declare the same optional field if implementations may reconstruct execution contexts.

`start_shell_session` creates both stream stages before filesystem writes, approval, or spawn. It redacts display metadata before adding it to the Shell snapshot. The running `ShellSessionRuntimeState` retains the port and stream after the initiating tool returns. Start no longer copies the execution context into shared `state.context`.

Output flows through:

1. UTF-8 decoding for Buffer events.
2. Raw-text stream redaction.
3. Terminal-control normalization.
4. Normalized-text stream redaction, covering secrets assembled by normalization.
5. `append_session_output`: public memory buffer, output file, previews, external references and waiter publication.

At process exit, the stream ends before the output write chain drains and terminal completion is published. Redaction failure suppresses all further output, requests SIGKILL, records a safe diagnostic, and forces a failed final result. Lifecycle state remains active until a real exit event so existing cleanup can retry termination.

`write_shell_session` accepts stdin only from the Session owning a privacy-enabled process. It retains the original stream rather than replacing its pending suffix. Raw stdin goes only to command validation and the child process; it is not stored in snapshots.

`HostApprovalRuntime` redacts the complete command/stdin, cwd and reason before constructing approval/audit data. It redacts stdin before preview truncation, preventing a long secret's unmatched prefix from reaching the audit file. Audit serialization redacts dynamic keys as well. Shell host warning logs use the action-local redactor.

`ShellPower.session_send` now accepts `reason`, required by the existing host stdin approval path.

## Remaining scope

Non-Shell private Power execution remains blocked temporarily because actions can persist arbitrary input or launch detached work. Its current match-based guard can reject unrelated inputs matching short known values. Replacing that heuristic requires the Agent to pass an explicit private-invocation marker derived before resolution; Shell no longer uses that heuristic.

The standalone `run_sandbox_command` SDK path has no Session privacy context and is not the Shell Power route. Custom sandbox providers remain responsible for not logging or persisting raw process requests; the audited native provider and City launcher do not write command/stdin text to their runtime directories. Arbitrary transformations or deliberate external transmission by executed programs are outside exact-value output redaction.

验证：共享 type、Agent 和 City 构建通过；City、CLI、Desktop 类型检查通过。现有 Agent 交互/模型工具执行 15 项检查与 Shell 审批/命令/进程 5 项检查通过；另使用合成值验证私密提交、引用解析、跨块输出及清理后遮罩。尚未完成真实 Desktop 手动输入与第三方服务联调。

## Changed City source files across this work

- `power/Power.ts`
- `power/core/PowerActionApproval.ts`
- `power/core/PowerActionExecution.ts`
- `power/core/PowerActionInteraction.ts`
- `power/core/PowerContext.ts`
- `power/core/PowerPrivateValues.ts` (new)
- `power/core/PowerRegistry.ts`
- `power/types/PowerCall.ts`
- `city/power/builtin/CityAction.ts`
- `city/power/builtin/shell/ShellPower.ts`
- `shell/Shell.ts`
- `shell/approval/HostApprovalRuntime.ts`
- `shell/session/ShellActionRuntimeSupport.ts`
- `shell/session/ShellPrivateValues.ts` (new)
- `shell/session/ShellProcessEvents.ts`
- `shell/session/ShellRuntimeTypes.ts`
- `shell/session/actions/ShellStartActions.ts`
- `shell/session/actions/ShellWriteActions.ts`
- `shell/tool/ShellTools.ts`
- `shell/PRIVATE_VALUES.md` (this document)
