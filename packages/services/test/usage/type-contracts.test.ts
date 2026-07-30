/**
 * Usage 服务类型契约测试。
 */

import { Federation } from "@downcity/city";
import { UsageService } from "../../src/index.js";

const base = new Federation({
  database: {} as never,
});

base.use(new UsageService({
  record_errors: true,
}));
