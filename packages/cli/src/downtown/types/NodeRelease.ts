/**
 * 本地 Node release 协议。
 *
 * release.json 是不可变产物描述，不保存运行配置、密钥或源码目录。
 * files_digest 同时绑定下列元数据和产物文件树；移动整个 release 不改变摘要。
 */

/** schema 1 的独立 Node 发布产物；由 builder 生成，由 reader 完整验证。 */
export interface NodeReleaseManifest {
  /** 发布协议版本，固定为 1；不接受其他版本的目录。 */
  schema: 1;
  /** 所属 downtown 的稳定 ID，必须与安装目标匹配。 */
  fed_id: string;
  /** 本次构建生成的时间前缀加 UUID；与 staging 目录名称无关。 */
  release_id: string;
  /** 构建完成时间，UTC ISO 8601 字符串。 */
  created_at: string;
  /** 项目 package.json 的 version；未声明时为 0.0.0。 */
  app_version: string;
  /** release 根目录下的 POSIX 相对入口，schema 1 固定为 app/index.mjs。 */
  entry: "app/index.mjs";
  /** 构建机 process.versions.node；运行时要求完整版本一致，以保守保护 native ABI。 */
  node_version: string;
  /** 构建机 process.platform；reader 要求与当前平台一致，不支持交叉编译。 */
  platform: string;
  /** 构建机 process.arch；reader 要求与当前 CPU 架构一致。 */
  arch: string;
  /** SHA-256 十六进制字符串，绑定其余 manifest 字段及文件路径、权限、内容和内部链接。 */
  files_digest: string;
}

/** builder 读取的 package.json 子集，不执行包内脚本。 */
export interface NodeReleasePackageJson {
  /** 包自身声明的名称；项目根包可以不声明。 */
  name?: string;
  /** 包自身声明的版本；项目根包缺省使用 0.0.0。 */
  version?: string;
  /** 包使用的模块解释方式；复制包时完整保留原始 package.json。 */
  type?: string;
  /** 项目及 workspace 包的发布文件白名单，支持 glob 和目录。 */
  files?: string[];
  /** 必须包含的生产依赖；从当前安装布局解析实际包。 */
  dependencies?: Record<string, string>;
  /** 可选生产依赖；本机未安装的包不包含在 release 中。 */
  optionalDependencies?: Record<string, string>;
  /** 已安装的 peer 依赖也复制，避免依赖运行时回退到源码或全局路径。 */
  peerDependencies?: Record<string, string>;
  /** peer 的可选性；缺少非可选 peer 时中止构建。 */
  peerDependenciesMeta?: Record<string, { /** 此 peer 是否允许未安装。 */ optional?: boolean }>;
  /** 旧式包运行入口；用于检查 workspace 构建输出是否存在。 */
  main?: string;
  /** ESM 包入口声明，保留条件分支和子路径的原始 JSON 结构。 */
  exports?: unknown;
}

/** 实际生产依赖图的节点；每个真实包目录只复制一次。 */
export interface NodeReleasePackageNode {
  /** 已解析 pnpm/workspace 链接的真实包根目录，仅在构建内存中使用。 */
  source_dir: string;
  /** release 内真实包目录的绝对路径，不引用源码目录。 */
  output_dir: string;
  /** 解析后的包元数据，用于递归收集生产依赖。 */
  package_json: NodeReleasePackageJson;
}
