/** 编译产物与源码定位元数据；仅由可信 Worker 持有。 */
export interface CompiledCell {
  /** 独立 async cell 的 JavaScript 产物。 */
  readonly javascript: string;
  /** TypeScript 编译器输出的 v3 source map。 */
  readonly source_map: string;
}
