/**
 * Federation 项目模板类型。
 *
 * 模板模块只返回待写入文件，不负责交互、覆盖确认或磁盘写入。
 */

/** 单个模板文件。 */
export interface FederationTemplateFile {
  /** 相对项目根目录的文件路径。 */
  path: string;
  /** 文件完整文本内容。 */
  content: string;
}

/** 内置模板生成参数。 */
export interface FederationTemplateInput {
  /** 新项目唯一 Fed ID。 */
  fed_id: string;
  /** 新项目名称。 */
  name: string;
}

/** 内置模板定义。 */
export interface FederationTemplateDefinition {
  /** CLI `--template` 使用的稳定模板 ID。 */
  id: "local-node" | "cloudflare-workers";
  /** 交互界面展示名称。 */
  label: string;
  /** 交互界面展示说明。 */
  hint: string;
  /** 根据项目身份生成完整文件集合。 */
  create_files: (input: FederationTemplateInput) => FederationTemplateFile[];
}
