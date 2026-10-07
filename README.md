# hono-cloudflare-rate-limit

[![npm](https://img.shields.io/npm/v/hono-cloudflare-rate-limit)](https://www.npmjs.com/package/hono-cloudflare-rate-limit)
[![license](https://img.shields.io/npm/l/hono-cloudflare-rate-limit)](./LICENSE)

A tiny, env-agnostic **[Hono](https://hono.dev) rate limit middleware for Cloudflare Workers**, built on the native [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) (`ratelimits` in `wrangler.jsonc` / `wrangler.toml`). Throttle API requests per IP, per user, or per API key and return `429 Too Many Requests` when the limit is exceeded — useful for protecting login, signup, password reset, and OTP endpoints from brute-force attacks and abuse at the edge.

The middleware only calls the binding, throws on overflow, and exposes an on/off hook. **You decide which binding to use, how to build the counter key, and when to skip limiting** — it never reads a fixed `env` shape, so it works in any Hono app on Cloudflare Workers.

## Install

```bash
npm install hono-cloudflare-rate-limit
# pnpm add hono-cloudflare-rate-limit
```

`hono` and `@cloudflare/workers-types` are peer dependencies.

## Runtime requirement

The `limit()` binding is a **Cloudflare Workers (workerd) only API**. It does not exist on Node.js, Bun, Deno, or other regular servers, so this middleware won't work there.

To rate limit an origin server through Cloudflare instead:

- Use **WAF Rate Limiting Rules** at the edge, or put a **thin Worker** in front of the origin.
- Lock the origin down to **Cloudflare IP ranges + Authenticated Origin Pulls (mTLS)**. Only then can you trust `CF-Connecting-IP` — requests that bypass the edge can omit or spoof that header.

## Usage

Declare a rate limit binding in `wrangler.jsonc`:

```jsonc
{
  "ratelimits": [
    {
      "name": "RL",
      "namespace_id": "1001",
      "simple": { "limit": 100, "period": 60 }
    }
  ]
}
```

Then apply the middleware:

```ts
import { Hono } from "hono";
import type { RateLimit } from "@cloudflare/workers-types";
import { rateLimit, cfConnectingIp } from "hono-cloudflare-rate-limit";

type AppEnv = {
  Bindings: { RL: RateLimit; APP_URL: string };
  Variables: {};
};

const app = new Hono<AppEnv>();

const guard = rateLimit<AppEnv>({
  // Return false to skip limiting, e.g. in local development.
  enabled: (c) => !c.env.APP_URL.startsWith("http://localhost"),
  limiter: (c) => c.env.RL,
  key: (c) => {
    const ip = cfConnectingIp(c);
    if (!ip) throw new Error("unknown client");
    return `api:${ip}`;
  },
});

app.use("/api/*", guard);
```

By default an exceeded limit throws `HTTPException(429, "too many requests")`. Pass `onExceeded` to return a custom response.

## Use cases

- **Per-IP API limit** — key by `api:${ip}` on `/api/*`.
- **Stricter limits on sensitive routes** — bind a separate, tighter limiter to login, signup, password reset, or OTP endpoints to slow down brute-force and spam.
- **Per-user or per-API-key quotas** — key by `user:${userId}` or `key:${apiKey}` for plan-based limits.
- **Disable in development** — return `false` from `enabled` for localhost.
- **Custom 429 response** — use `onExceeded` to send a JSON error body or a `Retry-After` header:

```ts
rateLimit<AppEnv>({
  limiter: (c) => c.env.RL,
  key: (c) => `login:${cfConnectingIp(c) ?? "unknown"}`,
  onExceeded: (c) => {
    c.header("Retry-After", "60");
    return c.json({ error: "rate_limited" }, 429);
  },
});
```

## API

### `rateLimit(options): MiddlewareHandler`

| Option       | Type                                          | Description                                                                                              |
| ------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `limiter`    | `(c) => RateLimit`                            | Picks the rate limit binding from `env`.                                                                 |
| `key`        | `(c) => string`                               | Builds the counter key. If it throws (e.g. client can't be identified), the error propagates as-is.     |
| `enabled?`   | `(c) => boolean`                              | Return `false` to skip limiting for this request. Defaults to always on.                                 |
| `onExceeded?` | `(c) => Response \| Promise<Response>`       | Response to send when the limit is exceeded. Defaults to throwing `HTTPException(429)`.                  |

### `cfConnectingIp(c): string | null`

Returns the `CF-Connecting-IP` header set by the Cloudflare edge. It is `null` for requests that didn't pass through the edge (local dev, service bindings, etc.).

## License

[MIT](./LICENSE)
