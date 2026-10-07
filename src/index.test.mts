import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { cfConnectingIp, rateLimit } from "./index.mts";

// RateLimit 바인딩 모조 객체
const mockLimiter = (success: boolean) => ({
  limit: vi.fn().mockResolvedValue({ success }),
});

describe("rateLimit", () => {
  it("성공 응답이면 다음 핸들러로 넘긴다", async () => {
    const app = new Hono();
    app.use("*", rateLimit({ limiter: () => mockLimiter(true), key: () => "k" }));
    app.get("/", (c) => c.text("ok"));

    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("초과(success: false)이면 429를 던진다", async () => {
    const app = new Hono();
    app.use("*", rateLimit({ limiter: () => mockLimiter(false), key: () => "k" }));
    app.get("/", (c) => c.text("ok"));

    const res = await app.request("/");
    expect(res.status).toBe(429);
  });

  it("onExceeded 가 있으면 커스텀 응답을 반환한다", async () => {
    const app = new Hono();
    app.use(
      "*",
      rateLimit({
        limiter: () => mockLimiter(false),
        key: () => "k",
        onExceeded: (c) => c.text("느려!", 429),
      }),
    );
    app.get("/", (c) => c.text("ok"));

    const res = await app.request("/");
    expect(res.status).toBe(429);
    expect(await res.text()).toBe("느려!");
  });

  it("enabled 가 false 를 반환하면 바인딩을 호출하지 않고 통과한다", async () => {
    const limiter = mockLimiter(false);
    const app = new Hono();
    app.use("*", rateLimit({ limiter: () => limiter, key: () => "k", enabled: () => false }));
    app.get("/", (c) => c.text("ok"));

    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(limiter.limit).not.toHaveBeenCalled();
  });

  it("key 함수가 throw 하면 에러가 전파된다", async () => {
    const app = new Hono();
    app.use(
      "*",
      rateLimit({
        limiter: () => mockLimiter(true),
        key: () => {
          throw new Error("클라이언트 식별 불가");
        },
      }),
    );
    app.get("/", (c) => c.text("ok"));

    const res = await app.request("/");
    expect(res.status).toBe(500);
  });
});

describe("cfConnectingIp", () => {
  it("CF-Connecting-IP 헤더가 있으면 그 값을 반환한다", async () => {
    let captured: string | null = null;
    const app = new Hono();
    app.get("/", (c) => {
      captured = cfConnectingIp(c);
      return c.text("ok");
    });

    await app.request("/", { headers: { "CF-Connecting-IP": "1.2.3.4" } });
    expect(captured).toBe("1.2.3.4");
  });

  it("헤더가 없으면 null 을 반환한다", async () => {
    let captured: string | null | undefined = undefined;
    const app = new Hono();
    app.get("/", (c) => {
      captured = cfConnectingIp(c);
      return c.text("ok");
    });

    await app.request("/");
    expect(captured).toBeNull();
  });
});
