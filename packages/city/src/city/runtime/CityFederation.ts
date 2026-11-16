/**
 * City 的 Federation 内存绑定。
 * 宿主拥有客户端和凭据持久化；绑定只管理当前引用及带 City 来源的用户视图。
 * 更换绑定不会触碰本地实体、transport 或 Power 的生命周期。
 */
import type { Federation, FederationUser } from "@downcity/federation";

export class CityFederation {
  /** 当前借用的客户端；由创建它的宿主负责释放。 */
  private client?: Federation;
  /** 活动绑定属于长期借用，阻止 owner 在绑定期间释放项目。 */
  private release_client?: () => void;
  /** 当前客户端的 City 来源视图，随绑定一起原子替换。 */
  private city_user?: FederationUser;
  /** 每次有效绑定变化递增，用于隔离旧身份的在途结果。 */
  private generation = 0;

  constructor(private readonly city_id: string) {}

  /** 当前绑定；未登录或已解除绑定时为空。 */
  get current(): Federation | undefined { return this.client; }
  /** 带当前 City 来源的用户能力；不会访问机器账户库。 */
  get user(): FederationUser | undefined { return this.city_user; }
  /** 当前绑定代次；客户端的凭据应保持不变，换身份时绑定新客户端。 */
  get revision(): number { return this.generation; }

  /** 同步绑定或解除绑定；不发起网络请求，也不释放宿主拥有的客户端。 */
  set(federation: Federation | undefined): void {
    if (this.client === federation) return;
    const release = federation?.retain();
    let user: FederationUser | undefined;
    try { user = federation?.user.with_city(this.city_id); }
    catch (error) { release?.(); throw error; }
    this.release_client?.();
    this.release_client = release;
    this.client = federation;
    this.city_user = user;
    this.generation += 1;
  }
}
