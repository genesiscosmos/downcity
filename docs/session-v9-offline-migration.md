<!-- v9 离线迁移的实现契约；用户命令说明维护在 homepage 的 Session 离线迁移文档。 -->
# Session v8 → v9 离线迁移

目标是让旧单库切换到单一永久 `session_id`，同时保持 canonical 历史、附件授权和可确定来源关系。运行时只读 v9；v8 SQL 仅冻结在 `scripts/fixtures/session-v8.sql` 供离线结构校验，不增加业务双读或自动迁移。

## 身份与所有权

- 每个 v8 记录的 `storage_id` 原值提升为永久 `session_id`，全根检查 UUID 合法性及唯一拥有者；消息来源、ResultRef 和附件统一使用该记录 UUID。旧逻辑地址和源存储字段名只存在于离线映射及原始备份，不进入 v9 schema、SDK 或业务响应。
- 批次清单声明 `identity_policy=preserve-record-uuid-v1`。所有批次读取（含 apply/verify/restore）拒绝缺省或其他策略，返回 `batch_identity_policy_requires_review`；逐行检查源/目标 UUID 相等、Agent 所属和 session_key 唯一性，暂存前与源库完整映射复核。策略/映射不由工具自动补写或改换，已转换 v9 数据不直接改写。
- 每批身份映射在修改任何 canonical 数据之前保存到私有清单，重入不能重新分配。
- 逻辑引用必须唯一匹配旧 Agent、分类和旧 ID；有精确旧记录 UUID 时交叉核对逻辑字段。只有原本明确表示当前活动记录的路由允许按活动状态筛选。历史 fork、结果与完成记录不能回落到最近或当前同名会话。
- 旧完成日志没有记录 UUID 且旧 ID 重复时，只有 Turn 与全部消息 ID 在同一 canonical 记录内唯一匹配才转换；旧结果引用使用消息 ID、消息序号、Part ID 与结果摘要共同证明唯一来源。缺失或多重匹配继续阻塞，不以时间或活动状态猜选。
- 主指针只接受唯一合格活动主会话；没有则为空，不能在迁移时创建新的业务历史。
- 已完成旧 receipt 与归档操作保留审计摘要及完整原始备份，不复用旧请求摘要证明 v9 幂等。未完成归档、待清理附件和待投递委派默认阻塞。
- Composer 派生检查点清空，原摘要留在备份中。普通消息和 Task prompt 不做文本替换。

## 模块边界

| 模块 | 唯一职责 |
| --- | --- |
| `migrate-session-sqlite-v9.mjs` | 封闭参数、模式选择和私有报告 |
| `session-v9-migration.mjs` | 批次生命周期、全根范围与所有权 |
| `session-v9-database.mjs` | 冻结源格式、流式指纹、正式 codec 验证 |
| `session-v9-identities.mjs` | 全根身份映射和声明过的 JSON 引用 |
| `session-v9-conversion.mjs` | 单个 Agent 库事务重建及附件 URL |
| `session-v9-results.mjs` | fork 来源验证、结果摘要、嵌套 lookup 页与游标 |
| `session-v9-references.mjs` | 完成日志、委派、Group、Task、通知及渠道引用 |
| `session-v9-settings.mjs` | Desktop 置顶与会话模型偏好 |
| `session-v9-recovery.mjs` | 显式恢复策略、来源摘要绑定与不可执行审计范围 |
| `session-v9-recovery-messages.mjs` | 未结束消息的确定性中断收口 |
| `session-v9-batch.mjs` | 一致性备份、原子文件替换和附件目录指纹校验 |

## 已审阅历史异常的恢复

默认保持严格阻塞。用户审阅并接受恢复行为后，预检和首次 apply 可以显式传入 `--recover-reviewed`，启用 `reviewed-interrupt-and-disable-v1` 策略：

- streaming 消息在新库中收口为中断，正文和已完成结果保留，未结束工具标记失败、待处理交互取消，追加明确的 `turn_stopped` 诊断；不执行工具，不改变已稳定 Part。
- Group metadata 仅允许大小写差异，以现存目录 ID 为准，同步声明过的来源与通知引用。已删除 Agent 的成员引用移入 `unavailable_member_sessions`；仍存在的 Agent 引用缺失继续阻塞。
- 无法唯一定位来源的已完成 completion/delegation 及 closed-turn 标记逐字节保留到 `.session-v9-audit/<migration_id>/`，不进入运行时可执行账本。待投递记录、非法格式和不符摘要继续阻塞。
- 无效 Task 投递暂停调度，原目标保留在 `unavailable_delivery`。失效旧 Chat 渠道暂停路由并保留原目标，待处理收发队列标记失败，载荷保留，不自动重试或创建替代会话。当前 Messenger 要求非空有效绑定，失效目标继续以 `messenger_route_requires_rebind` 阻塞，须先由其所属领域显式重新绑定。

每项决定包含结构地址与原始摘要，暂存必须精确重现预检计划。全部原始文件和数据库仍强制备份；审计文件属于完整批次校验与恢复范围，发生变化后禁止覆盖恢复。重入使用持久清单中的同一策略与身份映射。

## 发布与恢复

1. 默认预检只读源数据，在独立临时库执行真实转换与 codec/FK/计数校验；逐库处理，不把全部历史装进 JS 对象。
2. apply 必须显式声明全部写者已退出，同时持有 RootLease 和所有 Agent 附件独占租约。工具不会代替用户停止进程。
3. 全批原始备份完成后再构建暂存库；SQLite backup 保留已提交 WAL 和内部自增水位。文件复制先进入批次私有 pending 区，完整校验后发布。
4. 再次核对所有来源和引用范围，写入 v9 `migrating` 根标记，然后逐文件原子替换、逐附件目录核验，最后验证并发布 `ready`。
5. 附件目录源/目标路径相同，发布与恢复仅校验附件指纹，保留 inode、mtime 与媒体版本；所属清单作为独立文件转换为 v2 并可恢复。业务库、所有引用文件、附件以及新增/移除的资源名字均受指纹或范围校验保护。
6. 发布、标记或清单 ACK 中断时，同批重入仅接受原指纹或精确目标指纹，不猜执行结果，不覆盖其他批次。清单每 128 个工件保存一次进度及在阶段结束保存，单个工件的原子发布与指纹核对保证未保存 ACK 的操作可重入。
7. 已完成批次仅在全部目标仍匹配发布指纹时允许 restore；任何业务写入、新增资源或附件变化都先阻塞整批恢复。恢复自身也可以重入，原始和暂存副本保留。

## 显式边界

- 输入限定已完成的 v8 Agent 单库。更早分库、旧导入现场、Memory Job/订阅账本需要相应转换或独立审阅，不能绕过检查混入。
- 未声明的第三方 Power 载荷和任意正文不做猜测替换。可执行的未知引用协议需要增加领域适配器后才能纳入迁移。
- 报告仅含路径、身份、数量、摘要和诊断码。原始及暂存文件含真实用户数据，目录权限 0700、文件权限 0600，不提交到公开仓库。
- 全根离线迁移不会完成宿主其余未实现的 v9 API 改造。执行正式迁移前须让实际宿主构建和对应协议回归通过。

## 验证

从联合工作区根执行：

```bash
node --test public/scripts/migrate-session-sqlite-v9.test.mjs
pnpm --dir public patch:build -- --no-bump --city --no-global-install
pnpm --dir public/packages/city typecheck
```

测试通过真实临时根覆盖消息/fork/附件/外部引用、结果摘要与游标、主指针、备份恢复、业务写入后拒绝回退、根租约冲突及发布/恢复 ACK 中断。
