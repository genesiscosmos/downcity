# Downtown 用户会话、City 来源与资源权限

Downtown 是账户、用户会话和业务服务的事实源。`new Downtown({ url })` 访问远端，`new Downtown({ database })` 在进程内装配服务；两种方式共用用户与管理员 API、Request/Response 和授权规则。宿主显式注册需要的 Service，环境配置管理使用 `.use(new EnvService())`。

用户通过 Provider 登录，不需要注册产品或 City。用户 JWT 校验签名、issuer、audience、subject、到期与持久化撤销状态。管理员使用独立 Session；用户会话不能执行管理员操作。业务调用使用 `downtown.user.service(name)`，只发往当前 Downtown。

`CityOptions.city_id` 是可选来源标签。内存 City 自动生成临时 ID；CLI/Desktop 使用 `resolve_local_city_id(root)`，将稳定 ID 原子保存到 root 的 `city-id` 文件。它与每次启动的 `instance_id` 独立。`downtown.user.with_city(city_id)` 返回不可变来源视图，共享用户凭据，支持多个 City 并发使用同一 Downtown。

来源经 `x-downcity-city-id` 写入 Context、AI 用量、反馈和异步任务；直接用户调用可以省略。来源是自报信息，不证明机器身份，不授予权限，不扩大资源可见范围。图片结果要求任务 `user_id` 等于当前用户，不存在、无主和其他用户任务统一返回 404。

Organization 只管理组织、成员关系与治理。私有资料与成员列表要求活动成员；管理操作按 owner/admin 等角色检查。组织新建时 `join_policy=closed`，owner/admin 可改为 `approval`，登录用户按组织 ID 申请后由 owner/admin 审核。关闭新申请保留已有待审申请，申请者可以撤销自己的申请。Organization 不决定部署地址，也不签发产品凭据。业务 Service 根据自己的资源归属和当前 Membership 执行授权。

Credits、支付和用量以用户为归属。普通用户通过本人接口查询，管理写操作要求管理员 Session 或本地宿主显式授权的管理员上下文。City 来源不能替代用户或管理员授权。

Web OAuth 的 `redirect_uri` 必须逐字匹配 `AccountsService({ trusted_web_callbacks })` 中的 URL。空名单拒绝 Web OAuth。只接受规范 HTTPS URL 或明确本机 HTTP URL，且无凭据、query 或 fragment。Worker 从 `DOWNCITY_TRUSTED_WEB_CALLBACKS` JSON 数组读取配置，独立于 CORS。CLI/Desktop 使用 loopback、state、S256 PKCE、浏览器绑定、私密交换材料和一次性交换。

显式数据升级入口为 `scripts/migrate-city-sources.mjs`。先备份并用独占 Adapter 调用只读 `plan_city_source_migration(database)`，审核后再显式执行 `migrate_city_sources(database)`。历史来源归档保留，现有记录的 `city_id` 保持 NULL，不推断实际终端。迁移保留账户、签名密钥、会话、撤销、余额流水、成员、待审申请和任务；失败回滚，成功后重复执行无变更。部署与数据迁移需要分别授权。
