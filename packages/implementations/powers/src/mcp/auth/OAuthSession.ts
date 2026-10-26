/** SDK OAuth adapter: isolated credentials, cancellable loopback login and validated HTTPS discovery. */
import { auth, discoverOAuthServerInfo, extractWWWAuthenticateParams, type OAuthClientProvider, type OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { PowerLifecycleContext } from "@downcity/city/power";
import { wait_for_mcp } from "../runtime/Cancellation.js";
import { OAuthCallbackServer } from "./OAuthCallbackServer.js";
import { McpOAuthStorage } from "./OAuthStorage.js";
import type { McpOAuthCredential, McpOAuthState, McpOAuthTransportConfig } from "./OAuthTypes.js";

/** Trusted constructor dependencies; no credentials are exposed in status callbacks. */
export interface OAuthSessionOptions {
  /** Stable server identity. */
  server_id: string;
  /** Exact MCP resource URL. */
  endpoint: string;
  /** Host-owned credential directory store. */
  storage: McpOAuthStorage;
  /** Public client configuration. */
  config: McpOAuthTransportConfig;
  /** Existing host browser opener. */
  open_external: PowerLifecycleContext["system"]["open_external"];
  /** Receives only a non-secret authorization state. */
  on_state: (state: McpOAuthState) => void;
  /** Explicit UI action discards persisted tokens after issuer discovery. */
  force_login?: boolean;
}

/** Validate every OAuth URL before network access or opening a browser. */
function assert_https(value: string | URL): void {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("OAuth requires HTTPS metadata and endpoints");
}

/** SDK provider plus a single-flight authorization coordinator for one server/endpoint. */
export class McpOAuthProvider implements OAuthClientProvider {
  /** Latest issuer-bound record. */
  private credential?: McpOAuthCredential;
  /** Validated discovery, kept only for this connection lifetime. */
  private discovery?: OAuthDiscoveryState;
  /** Current redirect URI; generated before registration. */
  private redirect_uri = "http://127.0.0.1/callback";
  /** Memory-only PKCE verifier. */
  private verifier?: string;
  /** Memory-only CSRF state. */
  private csrf_state = "";
  /** One recovery operation per server. */
  private pending?: Promise<void>;
  /** Lifetime cancellation includes disposal and reconfiguration. */
  private readonly lifetime = new AbortController();
  /** Current authorization signal for SDK fetch. */
  private auth_signal?: AbortSignal;
  /** Listener is armed before the browser can redirect back. */
  private callback?: OAuthCallbackServer;
  /** Authorization code promise created by redirectToAuthorization. */
  private callback_result?: Promise<import("./OAuthCallbackServer.js").OAuthCallbackResult>;
  constructor(private readonly options: OAuthSessionOptions) {}

  get redirectUrl(): string { return this.redirect_uri; }
  get clientMetadata(): OAuthClientMetadata {
    return { client_name: this.options.config.client_name ?? "Downcity", redirect_uris: [this.redirect_uri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
  }
  state(): string { this.csrf_state = OAuthCallbackServer.create_state(); return this.csrf_state; }
  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.credential?.client ?? (this.options.config.client_id && this.discovery ? { client_id: this.options.config.client_id, issuer: this.discovery.authorizationServerUrl } : undefined);
  }
  async saveClientInformation(client_information: OAuthClientInformationMixed): Promise<void> {
    this.record().client = client_information;
    await this.persist();
  }
  tokens(): OAuthTokens | undefined { return this.credential?.tokens; }
  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this.auth_signal?.throwIfAborted();
    const record = this.record();
    record.tokens = tokens;
    record.expires_at = tokens.expires_in === undefined ? undefined : Date.now() + tokens.expires_in * 1000;
    await this.persist();
    this.options.on_state("authorized");
  }
  saveCodeVerifier(verifier: string): void { this.verifier = verifier; }
  codeVerifier(): string { if (!this.verifier) throw new Error("Missing PKCE verifier"); return this.verifier; }
  discoveryState(): OAuthDiscoveryState | undefined { return this.discovery; }
  saveDiscoveryState(discovery: OAuthDiscoveryState): void { this.discovery = discovery; }
  /** Browser is opened only inside an explicitly requested connection/authentication operation. */
  async redirectToAuthorization(url: URL): Promise<void> {
    assert_https(url);
    this.auth_signal?.throwIfAborted();
    this.options.on_state("authorizing");
    this.callback_result = this.callback!.wait(this.csrf_state, 300_000, this.auth_signal);
    void this.callback_result.catch(() => undefined);
    await wait_for_mcp(this.options.open_external({ url: url.href }), this.auth_signal);
  }
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    if (scope === "verifier") { this.verifier = undefined; return; }
    if (scope === "discovery") { this.discovery = undefined; return; }
    if (this.credential) {
      if (scope === "all" || scope === "client") this.credential.client = undefined;
      this.credential.tokens = undefined;
      this.credential.expires_at = undefined;
      await this.persist();
    }
    this.options.on_state("expired");
  }
  /** Resource fetch used by the SDK transport; a 401 is retried exactly once. */
  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const signal = AbortSignal.any([this.lifetime.signal, ...(init?.signal ? [init.signal] : [])]);
    if (this.expiring() || this.options.force_login) await this.recover(undefined, signal);
    const send = async () => {
      const headers = new Headers(init?.headers);
      const token = this.tokens()?.access_token;
      if (token) headers.set("authorization", `Bearer ${token}`);
      return await fetch(input, { ...init, headers, signal, redirect: "error" });
    };
    const response = await send();
    if (response.status !== 401) return response;
    const challenge = extractWWWAuthenticateParams(response);
    await response.body?.cancel();
    await this.recover(challenge.resourceMetadataUrl, signal, challenge.scope);
    const retried = await send();
    if (retried.status === 401) this.options.on_state("expired");
    return retried;
  };
  close(): void { this.lifetime.abort(); }

  private expiring(): boolean { return !!this.credential?.tokens && this.credential.expires_at !== undefined && this.credential.expires_at < Date.now() + 60_000; }
  private storage_key(issuer: string): string { return JSON.stringify([this.options.server_id, this.options.endpoint, issuer]); }
  private record(): McpOAuthCredential {
    if (!this.credential) this.credential = { issuer: this.discovery!.authorizationServerUrl, endpoint: this.options.endpoint };
    return this.credential;
  }
  private async persist(): Promise<void> {
    this.lifetime.signal.throwIfAborted();
    const record = this.record();
    await this.options.storage.save(this.storage_key(record.issuer), record);
  }
  private async recover(metadata_url: URL | undefined, signal: AbortSignal, scope?: string): Promise<void> {
    this.pending ??= this.authorize(metadata_url, signal, scope).finally(() => { this.pending = undefined; });
    await wait_for_mcp(this.pending, signal);
    signal.throwIfAborted();
  }
  private async authorize(metadata_url: URL | undefined, signal: AbortSignal, scope?: string): Promise<void> {
    const callback = new OAuthCallbackServer();
    this.auth_signal = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(300_000)]);
    const secure_fetch: typeof fetch = async (input, init) => {
      assert_https(input instanceof Request ? input.url : input);
      return await fetch(input, { ...init, signal: this.auth_signal, redirect: "error" });
    };
    try {
      assert_https(this.options.endpoint);
      if (metadata_url) assert_https(metadata_url);
      const discovery = await discoverOAuthServerInfo(this.options.endpoint, { resourceMetadataUrl: metadata_url, fetchFn: secure_fetch });
      const metadata = discovery.authorizationServerMetadata;
      if (!metadata || metadata.issuer !== discovery.authorizationServerUrl) throw new Error("OAuth issuer metadata mismatch");
      for (const value of [discovery.authorizationServerUrl, metadata.authorization_endpoint, metadata.token_endpoint, metadata.registration_endpoint]) if (value) assert_https(value);
      if (metadata.grant_types_supported && !metadata.grant_types_supported.includes("authorization_code")) throw new Error("OAuth authorization_code is unsupported");
      this.discovery = discovery;
      const stored = await this.options.storage.load(this.storage_key(discovery.authorizationServerUrl));
      this.credential = stored?.endpoint === this.options.endpoint && stored.issuer === discovery.authorizationServerUrl ? stored : undefined;
      if (this.options.force_login) {
        await this.options.storage.remove(this.storage_key(discovery.authorizationServerUrl));
        this.credential = undefined;
        this.options.force_login = false;
      }
      this.callback = callback;
      // Reuse a dynamic registration's loopback port when available, preserving refresh-token/client binding.
      const client = this.credential?.client;
      const previous_uri = client && "redirect_uris" in client ? client.redirect_uris[0] : undefined;
      const previous_url = previous_uri ? new URL(previous_uri) : undefined;
      const previous_port = previous_url?.hostname === "127.0.0.1" && previous_url.protocol === "http:" ? Number(previous_url.port) : 0;
      try { this.redirect_uri = await callback.start(previous_port); }
      catch (error) {
        if (!previous_port || (error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
        this.redirect_uri = await callback.start();
        this.credential = undefined;
      }
      const first = await auth(this, { serverUrl: this.options.endpoint, scope, fetchFn: secure_fetch });
      if (first === "REDIRECT") {
        const { code } = await this.callback_result!;
        await auth(this, { serverUrl: this.options.endpoint, authorizationCode: code, scope, fetchFn: secure_fetch });
      }
      this.options.on_state("authorized");
    } catch {
      this.options.on_state("expired");
      // Server errors can contain token responses or URLs: never forward their raw text to model logs.
      throw new Error("MCP OAuth authorization failed or cancelled. Check server OAuth metadata/client_id and retry authorization in MCP settings.");
    } finally {
      this.verifier = undefined;
      this.csrf_state = "";
      this.callback = undefined;
      this.callback_result = undefined;
      await callback.close();
    }
  }
}
