/**
 * @file 解析 Downcity public packages 的发布拓扑。
 *
 * 每个 package 的层级由运行时 Downcity 依赖自动推导。同层 package 可以并行发布，
 * 下一层必须等待上一层完成，避免上层 Job 占满 Runner 后反向等待底层 package。
 */

import { appendFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  MAX_PUBLISH_LAYERS,
  create_workflow_outputs,
  resolve_publish_layers,
} from "../../scripts/package-graph.mjs";

export {
  MAX_PUBLISH_LAYERS,
  create_workflow_outputs,
  resolve_publish_layers,
};

/** 将解析结果写入 GitHub Actions output。 */
function write_workflow_outputs(output_path, outputs) {
  if (!output_path) return;
  for (const [key, value] of Object.entries(outputs)) {
    appendFileSync(output_path, `${key}=${value}\n`, "utf8");
  }
}

/** CLI 入口。 */
function main() {
  const graph = resolve_publish_layers(process.cwd());
  const outputs = create_workflow_outputs(graph);
  write_workflow_outputs(process.env.GITHUB_OUTPUT, outputs);
  if (!process.env.GITHUB_OUTPUT) console.log(JSON.stringify({ graph, outputs }, null, 2));
}

const current_file = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(current_file).href) {
  main();
}
