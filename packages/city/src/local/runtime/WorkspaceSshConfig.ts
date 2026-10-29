/**
 * Workspace SSH 授权记录校验。
 *
 * 从数据库或宿主服务取得授权时均校验完整结构，损坏记录直接报错，
 * 不把无效授权降级成“未授权”后悄悄继续执行。
 */

import path from "node:path";
import { z } from "zod";
import type { LocalWorkspaceSshAuthorization } from "../types/WorkspaceSsh.js";

/** 持久授权的完整形状；对象字段不允许被字符串强制转换。 */
const workspace_ssh_schema = z.strictObject({
  socket_path: z.string().min(1).refine(path.isAbsolute),
  socket_device: z.string().regex(/^\d+$/),
  socket_inode: z.string().regex(/^\d+$/),
  known_hosts_path: z.string().min(1).refine(path.isAbsolute),
  authorized_at: z.iso.datetime(),
});

/** 校验宿主记录，返回独立的有效授权快照。 */
export function parse_workspace_ssh_authorization(input: unknown): LocalWorkspaceSshAuthorization {
  return workspace_ssh_schema.parse(input);
}
