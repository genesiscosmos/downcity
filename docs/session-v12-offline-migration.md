<!-- v12 迁移的开发边界；用户操作说明位于 homepage 中英文 Session 离线迁移页。 -->

# Session v11→v12 离线转换

正式 Agent 存储与 City 根门禁只接受 schema12。启动及读取不迁移历史格式；版本不符报告 `session_migration_required`。历史 `inbox`、`power` Part 若进入当前 codec，同样报告需要显式迁移，不包装成含糊的事务失败。

历史协议固定在 `scripts/fixtures/session-v11/`，包含完整 DDL、消息 codec、输入校验、视图校验与根门禁。v10→v11 工具固定输出 v11，不随正式运行时升级。v9/v10 codec 复用离线目录中的旧输入及视图校验，不依赖已经删除的源码路径。历史逻辑不进入 SDK 运行路径。

`session-v12-conversion.mjs` 只映射框架定义的 `inbox`→`input`、输入顶层 `inbox_id`→`input_id`、`power`→`view`。业务 JSON、正文、工具结果、保存的模型视图及结果引用不做递归替换。迁移在 SQLite 一致性副本内重建 `message_parts` 与 `storage_metadata`，复制后才安装正式索引和触发器，保留不可变前缀及 Step 边界。

转换前后均校验正式 DDL、完整性、外键与所有消息 codec。流式摘要按主键覆盖每个表、字段及 `sqlite_sequence`，仅将格式版本和上述 Part 映射归一化；规范内容摘要必须相等。会话身份、消息、时间、水位、检查点、配置、receipt、归档计划和附件全部保留。

`session-version-migration.mjs` 统一拥有整根迁移的批次、租约、备份、发布及恢复生命周期。v11/v12 入口仅声明源/目标版本与转换策略。预检只读源并绑定完整根范围、源指纹、业务摘要和附件清单。apply 在根独占和全部 Agent 文件独占租约下，先备份所有源，再转换所有 stage，全部验证后才写 migrating 并逐库原子发布，最终写 ready。确认丢失使用原批次续跑；后续业务写入或附件变化拒绝 restore。原始备份始终保留。

正式单记录转移使用独立包 format3/schema12 和导入批次 format3。历史 schema11/10/9 包通过冻结协议验证后，显式转换到新的 schema12 包；schema8 先执行原有身份转换。单记录和整库转换复用唯一 Part 映射，不重新计算工具首次披露或清除已有检查点。

`migrate-session-sqlite-v12.test.mjs` 验证独立逐字段对比、正文内同名字段不变、稳定触发器、新 Part 写入约束、预检停写、租约冲突、全源先备份、发布/恢复确认丢失、业务变化拒绝恢复、单记录包转换及真实 CLI 流程。临时测试根与真实用户根隔离。
