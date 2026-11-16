/**
 * 显式离线包转换入口；不读取运行数据根。旧包由隔离历史协议验证，
 * 首次披露证据不足时阻断；输出新路径 format3/schema10，保留UUID及固定视图。
 */
import path from "node:path";
import { pathToFileURL as path_to_file_url } from "node:url";
import { load_runtime } from "./lib/session-runtime.mjs";
import { fail } from "./lib/session-v7-database.mjs";
import { diagnostic } from "./lib/session-v8-files.mjs";
import { uuid_pattern } from "./lib/session-v9-identities.mjs";
import { convert_legacy_package } from "./lib/session-transfer-conversion.mjs";

/** 所有路径显式提供，未知/重复参数和 operation_id 均在读取包前拒绝。 */
export function parse_arguments(arguments_) {
  const input = {}; const seen = new Set();
  const fields = { "--package": "package_path", "--output": "output_path", "--operation-id": "operation_id" };
  for (let index = 0; index < arguments_.length; index++) {
    const option = arguments_[index];
    if (seen.has(option)) fail("duplicate_argument"); seen.add(option);
    if (option === "--help") input.help = true;
    else if (fields[option]) {
      const value = arguments_[++index]; if (!value || value.startsWith("--")) fail("missing_argument_value");
      input[fields[option]] = option === "--operation-id" ? value : path.resolve(value);
    } else fail("unknown_argument");
  }
  if (!input.help && (!input.package_path || !input.output_path || !uuid_pattern.test(input.operation_id ?? ""))) fail("transfer_legacy_explicit_parameters_required");
  return input;
}

/** 只输出结构状态；不展示包正文或原始 SQL/文件错误。 */
export async function run(input) {
  if (input.help) {
    console.log("node scripts/convert-session-package.mjs --package PATH --output NEW_PATH --operation-id UUID\nConverts proven format 2/schema 9 or self-contained format 1/schema 8 packages to format 3/schema 10. Missing/unknown/conflicting first-disclosure evidence blocks conversion. Original package stays unchanged; incomplete outputs require review, never overwrite.");
    return 0;
  }
  console.log(JSON.stringify(await convert_legacy_package(input, await load_runtime(true))));
  return 0;
}
if (process.argv[1] && import.meta.url === path_to_file_url(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await run(parse_arguments(process.argv.slice(2))); }
  catch (error) { console.error(JSON.stringify({ status: "failed", reason: diagnostic(error) })); process.exitCode = 1; }
}
