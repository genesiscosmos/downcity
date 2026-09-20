/** @downcity/sandbox-native 公开入口。 */

export { NativeSandboxProvider } from "./NativeSandboxProvider.js";
export type { NativeProviderOptions } from "./types/NativeProvider.js";
export type {
  PathRuleSource,
  ResolvedPathRule,
  ResolvedSandboxPolicy,
} from "./types/SandboxPolicy.js";
export { resolve_sandbox_policy } from "./policy/SandboxPolicy.js";
export { build_seatbelt_profile } from "./policy/SeatbeltProfile.js";
export { build_bubblewrap_prefix } from "./policy/BubblewrapArgv.js";
export {
  resolve_wrapper_binary,
  wrap_sandbox_invocation,
} from "./policy/Wrapper.js";
export { explain_sandbox_denial } from "./policy/DenialExplainer.js";
export { build_sandbox_probes } from "./doctor/SandboxProbes.js";
export { run_sandbox_doctor } from "./doctor/SandboxDoctor.js";
export type {
  SandboxDoctorReport,
  SandboxProbe,
  SandboxProbeExpectation,
  SandboxProbeResult,
  SandboxProbeSeverity,
} from "./types/SandboxDoctor.js";
