/**
 * 旧 @downcity/city 导出面的迁移入口。
 *
 * 该入口只供仓库内 city 薄转发 package 使用；新代码应直接从
 * @downcity/federation 根入口按 Federation、Embassy、Bureau 语义导入。
 */

export * from "./index.js";
export { Bureau, BureauUser } from "./client/bureau.js";
export { City } from "./client/city.js";
export { FederationAdmin } from "./pact/admin/index.js";
export type { CityOptions } from "./client/types.js";
export type { FederationAdminOptions } from "./pact/admin/types.js";
export type { CityQueueAdapter, CityQueueMessage } from "./federation/queue.js";
export type { CityTableApi } from "./store/table-api.js";
export type { CityUserSchemaInput } from "./store/types.js";
export type {
  CityModelDescriptor,
  CityModelEnvRequirement,
  CityModelReasoning,
  CityModelReasoningEffort,
} from "@downcity/type";
export { CityModel } from "./pact/invoker/ai/CityModel.js";
export {
  BureausInvoker,
  BureauTokensInvoker,
} from "./pact/invoker/bureaus/index.js";
export type {
  BureauServerRecord,
  BureauServerUpdateInput,
  BureauTokenRecord,
  BureauTokenSummary,
  BureauTokenIssueResult,
  IssueBureauTokenInput,
} from "./types/Bureau.js";
