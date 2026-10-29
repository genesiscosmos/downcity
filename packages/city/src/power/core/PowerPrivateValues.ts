/**
 * City publication boundaries for Session private values.
 *
 * Redaction uses the originating Session port and includes object keys. Private
 * Power execution is currently unsupported: actions may write arbitrary storage
 * or launch detached work without carrying a redactor. Shell owns its audited
 * execution path and carries this minimal redaction port per execution, retaining
 * streaming state on the running Shell session rather than a shared host context.
 */

import type { SessionInteractionPort, SessionSecretStreamRedactor } from "@downcity/type";

/** Shared per-execution stream contract; pending suffixes remain private in memory. */
export type SecretRedactionStream = SessionSecretStreamRedactor;

/**
 * Minimal projection of the shared Session port. Field contracts and comments
 * remain defined by SessionInteractionPort; no raw secret list crosses it.
 */
export type PrivateValuePort = Pick<
  SessionInteractionPort,
  "redact_secret_values" | "create_secret_stream_redactor"
>;

/** Stable diagnostic containing neither input nor dynamically supplied names. */
const PRIVATE_EXECUTION_ERROR =
  "Private input is not supported by this City Power execution path yet; "
  + "the call was blocked before execution because persistent and streaming sinks cannot guarantee redaction.";

/**
 * Redact JSON-compatible publication data, including dynamic property names.
 * A redactor failure must stop publication; never fall back to the original.
 */
export function redact_public_value<T>(
  value: T,
  port: PrivateValuePort | undefined,
): T {
  if (!port) return value;
  const visit = (current: unknown): unknown => {
    if (typeof current === "string") return port.redact_secret_values(current);
    if (Array.isArray(current)) return current.map(visit);
    if (current !== null && typeof current === "object") {
      if (current instanceof Error) return visit(current.message);
      return Object.fromEntries(Object.entries(current).map(([key, item]) => [
        String(port.redact_secret_values(key)),
        visit(item),
      ]));
    }
    return port.redact_secret_values(current);
  };
  try {
    return visit(value) as T;
  } catch {
    throw new Error("Session private value redaction failed; publication was blocked.");
  }
}

/**
 * Fail closed on known resolved secrets and unresolved references, in keys and
 * values. The Session port must accompany every resolved invocation; a missing
 * port cannot identify already-resolved plaintext and is an upstream violation.
 */
export function assert_public_execution_input(
  value: unknown,
  port: PrivateValuePort | undefined,
): void {
  try {
    const serialized = JSON.stringify(value);
    if (serialized?.includes("${secrets.")) throw new Error(PRIVATE_EXECUTION_ERROR);
    if (JSON.stringify(redact_public_value(value, port)) !== serialized) {
      throw new Error(PRIVATE_EXECUTION_ERROR);
    }
  } catch {
    throw new Error(PRIVATE_EXECUTION_ERROR);
  }
}

/** Wrap requests before the Session persists or publishes an interaction. */
export function create_private_safe_interaction_port(
  port: SessionInteractionPort,
): SessionInteractionPort {
  return {
    create_secret_stream_redactor: () => port.create_secret_stream_redactor(),
    request: (input) => port.request(redact_public_value(input, port)),
    ...(port.approval ? {
      approval: {
        request: (input) => port.approval!.request(redact_public_value(input, port)),
      },
    } : {}),
    resolve_secret_references: (input) => port.resolve_secret_references(input),
    redact_secret_values: (value) => redact_public_value(value, port),
  };
}
