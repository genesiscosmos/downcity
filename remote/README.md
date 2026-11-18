<!-- Remote development, deployment reference, and user connection requirements. -->

# Downcity Remote

Open-source browser client for conversations with your Downcity agents. The application is a static React/Vite site and connects directly to a City through `@downcity/city/browser`. Conversation rendering, streaming, history and input use `@downcity/ui`.

## Development

Install dependencies from the workspace root. In the combined repository, run `pnpm install` from `downcity/`; in an independent public repository checkout, run it from that repository root.

Build the workspace SDK dependencies first if their generated outputs are missing. From the public repository root:

```sh
pnpm patch:build -- --no-bump --city --no-global-install
pnpm --filter @downcity/ui build
pnpm --filter @downcity/remote build
```

To start a local development preview when needed:

```sh
pnpm --filter @downcity/remote dev
```

`pnpm --filter @downcity/remote typecheck` checks application types. Production output is `remote/dist/`.

## Cloudflare deployment

Remote is published at [remote.downcity.ai](https://remote.downcity.ai) as the independent `downcity-remote` Workers static-assets project. `remote/wrangler.toml` declares the asset directory and custom domain; there are no API, database or credential bindings.

From the public repository root, after authenticating Wrangler with the Cloudflare account that owns `downcity.ai`:

```sh
NODE_ENV=production pnpm --filter @downcity/remote build
pnpm dlx wrangler@4.149.0 deploy --config remote/wrangler.toml
```

Deployment uploads the static build and binds the custom domain with managed HTTPS. Build commands alone do not deploy. The site connects directly to the City address decoded from the user's connection code; publishing Remote does not expose a local City to the internet.

## Connecting

1. In Desktop, enable **Settings → City Remote**, then select **Create connection code**. Enter a recipient note and a City address reachable by the recipient, choose Agent permissions and expiry, and create the code. Every creation issues an independent token.
2. Copy the complete code from its one-time display and send it privately. Closing the dialog clears the code. Existing authorizations can be edited or revoked, but their plaintext cannot be recovered; create another code if needed.
3. Paste the code into Remote's single connection-code field. Remote decodes it locally and shows the City address. Confirm the address, then click **Connect** to access the authorized Agents.

For Desktop and Remote on the same computer, use `http://127.0.0.1:5314` as the City address and open a local Remote at `http://127.0.0.1:5173` or `http://localhost:5173`. Desktop permits both local origins and `https://remote.downcity.ai` through CORS. Other recipients need a City address reachable from their own browser.

For an HTTPS Remote site, the code must contain a reachable City HTTPS address with a certificate the browser trusts. Other City hosts must permit the application's exact origin through `runtime.http.allowed_origins` or their own CORS policy. Endpoints must support `OPTIONS`, `GET`, `POST`, `Authorization` and `Content-Type`, and pass streaming responses without buffering. Configure any reverse proxy, VPN or tunnel yourself. DNS and CORS alone do not expose a private City or provide HTTPS.

The connection-code format is `citycode:<base64url UTF-8 JSON {url,token}>`. `@downcity/city/browser` exports `encode_city_connection({ url, token })`, `decode_city_connection(code)` and the `CityConnection` type with `url` and `token` fields. The helpers strictly validate the format locally; decoding does not verify reachability or authorization. Encoding is not encryption: anyone holding a code can use its authorized Agents until expiry or revocation. A recipient note does not bind access to a person's identity or prevent forwarding. Send codes privately and revoke exposed authorizations.

Remote connects directly from the browser to City, without a Downcity backend relay. It does not read connection codes from the page URL or persist codes or credentials; only a validated, non-sensitive City address may be remembered. The active connection uses its credential in memory. Reloading or disconnecting releases the client; paste the code again to reconnect. Conversation messages remain in City. Disconnecting releases the browser client without stopping server execution. Reconnection reloads authoritative state without resending prompts.

Select an Agent to browse its `chat` sessions, open history or create a new conversation. Session creation uses `origin: { category: "chat", type: "agent" }`. The sidebar lists the City's chat category, including conversations started through other clients. Private questions use the Agent's dedicated private submission API and never write answers into browser storage.

See the user guide at [downcity.ai/docs/remote](https://downcity.ai/docs/remote).
