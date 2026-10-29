/**
 * Per-execution Shell privacy state.
 *
 * Only redaction functions cross this boundary. Streams belong to a running
 * process, survive the initiating tool call, and must observe secrets submitted
 * before later stdin writes. Session implementations keep the raw secret list.
 * Session-backed execution requires the streaming factory even for public input:
 * an ordinary command can echo a secret previously written to a file. Streams
 * absorb current values on empty writes before stdin, retaining them after clear.
 */

import type { ShellExecutionContext, ShellHostContext } from "@downcity/type/shell";
import type { PrivateValuePort, SecretRedactionStream } from "@/power/core/PowerPrivateValues.js";

/** Execution-local extension carried structurally through the Shell runner. */
export interface PrivateShellExecutionContext extends ShellExecutionContext {
  /** Originating Session redactor; never shared through mutable Workspace state. */
  private_values?: PrivateValuePort;
}

/** Host context constructed anew for each Shell action. */
export interface PrivateShellHostContext extends ShellHostContext {
  /** Redactor for this action's approvals, audit and initial execution metadata. */
  private_values?: PrivateValuePort;
}

/** Safe failure text; never includes command, stdin, paths or the original exception. */
export const SHELL_REDACTION_ERROR = "Shell private-value redaction failed; further output was suppressed and process termination was requested.";

/** Normalize terminal controls only after raw-secret matching. */
function normalize_output(text: string): string {
  return text.replace(/\r/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/**
 * Redact both the raw stream and its normalized form. Each stage buffers across
 * chunk boundaries, including control removal that could assemble a secret.
 * A missing/failing Session factory aborts before spawn; stream failures stop
 * the process. Ports without Session context keep ordinary execution semantics.
 */
export function create_shell_output_redactor(
  port: PrivateValuePort | undefined,
): SecretRedactionStream {
  if (!port) {
    return { write: normalize_output, end: () => "" };
  }
  if (!port.create_secret_stream_redactor) {
    throw new Error("Session Shell execution requires create_secret_stream_redactor; execution was blocked before process startup.");
  }
  try {
    const raw_stream = port.create_secret_stream_redactor();
    const normalized_stream = port.create_secret_stream_redactor();
    for (const stream of [raw_stream, normalized_stream]) {
      if (!stream || typeof stream.write !== "function" || typeof stream.end !== "function") {
        throw new Error(SHELL_REDACTION_ERROR);
      }
    }
    let finished = false;
    return {
      write(chunk) {
        if (finished) return "";
        return normalized_stream.write(normalize_output(raw_stream.write(chunk)));
      },
      end() {
        if (finished) return "";
        finished = true;
        return normalized_stream.write(normalize_output(raw_stream.end())) + normalized_stream.end();
      },
    };
  } catch {
    throw new Error(SHELL_REDACTION_ERROR);
  }
}
