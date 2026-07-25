/**
 * ProjectSetup：本地 Agent 启动前项目结构准备模块。
 *
 * 关键点（中文）
 * - 统一确保 `.downcity/*` 目录结构存在，避免调用方重复拼装目录逻辑。
 */

import fs from "fs-extra";
import path from "node:path";
import {
  getCacheDirPath,
  getLogsDirPath,
  getDowncityDataDirPath,
  getDowncityDebugDirPath,
  getDowncityDirPath,
  getDowncityProfileDirPath,
  getDowncityPublicDirPath,
  getDowncityTasksDirPath,
} from "@/config/Paths.js";
import { get_sdk_agents_root_dir_path } from "@/store/LocalStorePaths.js";

/**
 * 确保 `.downcity` 运行目录结构完整。
 */
function ensure_runtime_directories(projectRoot: string): void {
  // 关键点（中文）：尽量只在启动时确保目录结构存在，避免在 Agent/Tool 执行过程中反复 ensure。
  fs.ensureDirSync(getDowncityDirPath(projectRoot));
  fs.ensureDirSync(getDowncityTasksDirPath(projectRoot));
  fs.ensureDirSync(getLogsDirPath(projectRoot));
  fs.ensureDirSync(getCacheDirPath(projectRoot));
  fs.ensureDirSync(getDowncityProfileDirPath(projectRoot));
  fs.ensureDirSync(getDowncityDataDirPath(projectRoot));
  fs.ensureDirSync(get_sdk_agents_root_dir_path(projectRoot));
  fs.ensureDirSync(getDowncityPublicDirPath(projectRoot));
  fs.ensureDirSync(path.join(projectRoot, ".agents", "skills"));
  fs.ensureDirSync(getDowncityDebugDirPath(projectRoot));
}

/**
 * runtime 启动前准备项目结构。
 */
export function ensureRuntimeProjectReady(projectRoot: string): void {
  ensure_runtime_directories(projectRoot);
}
