/**
 * Workspace 结构化文件工具产生的文件修改事实。
 *
 * 该协议只描述一次已经成功提交的原子文件修改，不推断 Shell、外部进程或编辑器行为。
 * 文件内容只在体积受控且可解码为文本时保留，供上层生成稳定 Diff。
 */

import type { RuntimeToolEffect } from "@downcity/type";

/** Workspace 文件修改使用的稳定 Runtime Tool effect 类型。 */
export const WORKSPACE_FILE_MUTATION_EFFECT_TYPE = "workspace.file_mutation";

/** 单个文件在一次结构化修改前后的不可变状态。 */
export interface WorkspaceFileMutationState {
  /** 该状态下目标文件是否存在。 */
  readonly exists: boolean;
  /** 文件存在且已读取时的 SHA-256；无法安全读取时省略。 */
  readonly sha256?: string;
  /** 文件存在、属于文本且未超过观测上限时的完整内容。 */
  readonly content?: string;
}

/** 一次成功的 Workspace 结构化文件修改。 */
export interface WorkspaceFileMutation {
  /** 经过 Workspace 路径策略校验后的目标绝对路径。 */
  readonly file_path: string;
  /** 原子修改提交前最接近写入检查点的文件状态。 */
  readonly before: WorkspaceFileMutationState;
  /** 原子修改成功提交后的文件状态。 */
  readonly after: WorkspaceFileMutationState;
}

/** 文件 action 可选的修改事实观察器。 */
export interface WorkspaceFileMutationObserver {
  /** 接收一次已经成功提交的结构化文件修改。 */
  on_file_mutation(mutation: WorkspaceFileMutation): void;
}

/** Workspace 文件修改向 Turn 报告的结构化副作用。 */
export interface WorkspaceFileMutationEffect
  extends RuntimeToolEffect<WorkspaceFileMutation> {
  /** 副作用类型固定为 Workspace 文件修改。 */
  readonly type: typeof WORKSPACE_FILE_MUTATION_EFFECT_TYPE;

  /** 已经成功提交的原子文件修改事实。 */
  readonly data: WorkspaceFileMutation;
}

/** 把一次文件修改事实封装为宿主可通用收集的 Tool effect。 */
export function create_workspace_file_mutation_effect(
  mutation: WorkspaceFileMutation,
): WorkspaceFileMutationEffect {
  return Object.freeze({
    type: WORKSPACE_FILE_MUTATION_EFFECT_TYPE,
    data: mutation,
  });
}
