// hono-cloudflare-rate-limit — Cloudflare Workers 의 RateLimit 바인딩을 감싸는
// env-비의존 Hono 미들웨어.
//
// 이 패키지는 "바인딩 호출 + 실패 시 던지기 + on/off 훅"만 안다. 어떤 바인딩을
// 쓸지, 카운터 키를 어떻게 만들지, 언제 끌지(예: 개발환경) 같은 정책은 전부
// 소비자(라우트를 소유한 워커)가 결정한다.
//
// 주의: `limit()` 바인딩은 Cloudflare Workers(workerd) 런타임 전용 API 다.
// Node.js/NestJS 등 일반 런타임에는 이 바인딩이 존재하지 않으므로 이 패키지도
// 동작하지 않는다(README 참고).
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { RateLimit } from "@cloudflare/workers-types";

export type RateLimitOptions<
  E extends { Bindings: object; Variables: object } = {
    Bindings: object;
    Variables: object;
  },
> = {
  /** env 에서 쓸 RateLimit 바인딩을 고른다. */
  limiter: (c: Context<E>) => RateLimit;
  /** 카운터 키를 파생한다. 키를 만들 수 없는 상황(예: 클라이언트 식별 불가)의
   *  처리는 소비자 책임 — 여기서 throw 하면 미들웨어가 그대로 전파한다. */
  key: (c: Context<E>) => string;
  /** false 를 반환하면 이 요청은 리밋을 건너뛴다(예: 개발환경). 생략하면 항상 적용. */
  enabled?: (c: Context<E>) => boolean;
  /** 초과 시 동작. 생략하면 HTTPException(429, "too many requests") 를 던진다. */
  onExceeded?: (c: Context<E>) => Response | Promise<Response>;
};

/** RateLimit 바인딩으로 요청을 제한하는 Hono 미들웨어를 만든다. */
export const rateLimit = <E extends { Bindings: object; Variables: object }>(
  opts: RateLimitOptions<E>,
): MiddlewareHandler<E> => {
  return async (c, next) => {
    // 소비자가 이 요청에 대해 리밋을 껐으면(예: 개발환경) 그대로 통과.
    if (opts.enabled && !opts.enabled(c)) return next();

    const { success } = await opts.limiter(c).limit({ key: opts.key(c) });
    if (!success) {
      if (opts.onExceeded) return opts.onExceeded(c);
      throw new HTTPException(429, { message: "too many requests" });
    }
    return next();
  };
};

/** Cloudflare 엣지가 찍는 표준 클라이언트 IP 헤더. 엣지를 거치지 않은 요청
 *  (로컬 dev, service binding 등)에는 없으므로 null 이 반환될 수 있다. */
export const cfConnectingIp = (c: Context): string | null =>
  c.req.header("CF-Connecting-IP") ?? null;
