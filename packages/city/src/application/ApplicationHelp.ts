/** 公开应用帮助的唯一参数契约：工具与脚本共用校验和生成文档，不接受代码或宿主内部路径。 */
import { z } from "zod";

/** 空参数读取根索引；搜索与符号定位互斥，游标按公开成员分页。 */
export const application_help_schema = z.object({
  query: z.string().max(200).optional().describe("Search public member names and descriptions."),
  symbol: z.string().max(200).optional().describe("Read a public object or member and its descendants."),
  cursor: z.number().int().min(0).optional().describe("Continue from next_cursor; each page contains at most 12 members."),
}).strict().refine(value => !(value.query && value.symbol), "query and symbol are mutually exclusive");
