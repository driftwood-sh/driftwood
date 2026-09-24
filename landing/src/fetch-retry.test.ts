import assert from "node:assert/strict";
import test from "node:test";

import { isReconnecting } from "./connection-status.ts";
import {
  backoffMs,
  fetchWithRetry,
  installFetchRetry,
  isRetryableRequest,
  retryAfterMs,
  type Fetcher,
} from "./fetch-retry.ts";

const ORIGIN = "https://driftwood.sh";

function scripted(steps: Array<number | Error>, headers: Record<string, string> = {}) {
  const seen: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetcher: Fetcher = async (input, init) => {
    const step = steps[Math.min(seen.length, steps.length - 1)];
    seen.push({ input, init });
    if (step instanceof Error) throw step;
    return new Response(step === 200 ? "{}" : "", { status: step, headers });
  };
  return { fetcher, seen };
}

const noWait = async () => {};

test("retryAfterMs reads seconds and HTTP dates, and caps them", () => {
  assert.equal(retryAfterMs(null), null);
  assert.equal(retryAfterMs(""), null);
  assert.equal(retryAfterMs("soon"), null);
  assert.equal(retryAfterMs("5"), 5000);
  assert.equal(retryAfterMs("100000"), 60_000);
  const now = Date.parse("2026-09-24T10:00:00Z");
  assert.equal(retryAfterMs("Thu, 24 Sep 2026 10:00:07 GMT", now), 7000);
  assert.equal(retryAfterMs("Thu, 24 Sep 2026 09:59:00 GMT", now), 0);
});

test("backoffMs doubles from 1 s, caps at 15 s, and jitters to [d/2, d]", () => {
  assert.equal(backoffMs(0, () => 0), 500);
  assert.equal(backoffMs(0, () => 1), 1000);
  assert.equal(backoffMs(2, () => 1), 4000);
  assert.equal(backoffMs(10, () => 1), 15_000);
  assert.equal(backoffMs(10, () => 0), 7500);
});

test("a GET retries through 429 and 503, honoring Retry-After", async () => {
  const waits: number[] = [];
  const { fetcher, seen } = scripted([429, 503, 200], { "Retry-After": "2" });
  const res = await fetchWithRetry(fetcher, "/api/v1/dashboard/sends", undefined, {
    attempts: 5,
    sleep: async (ms) => {
      waits.push(ms);
      assert.equal(isReconnecting(), true);
    },
  });
  assert.equal(res.status, 200);
  assert.equal(seen.length, 3);
  assert.deepEqual(waits, [2000, 2000]);
  assert.equal(isReconnecting(), false);
});

test("the last transient answer is returned when the budget runs out", async () => {
  const { fetcher, seen } = scripted([503]);
  const res = await fetchWithRetry(fetcher, "/api/x", undefined, { attempts: 3, sleep: noWait });
  assert.equal(res.status, 503);
  assert.equal(seen.length, 3);
  assert.equal(isReconnecting(), false);
});

test("non-transient answers return at once", async () => {
  for (const status of [200, 400, 401, 403, 404, 500]) {
    const { fetcher, seen } = scripted([status]);
    const res = await fetchWithRetry(fetcher, "/api/x", undefined, { attempts: 5, sleep: noWait });
    assert.equal(res.status, status);
    assert.equal(seen.length, 1, `status ${status}`);
  }
});

test("network errors retry; aborts and other errors do not", async () => {
  const flaky = scripted([new TypeError("Failed to fetch"), 200]);
  const res = await fetchWithRetry(flaky.fetcher, "/api/x", undefined, { attempts: 5, sleep: noWait });
  assert.equal(res.status, 200);
  assert.equal(flaky.seen.length, 2);

  const aborted = scripted([new DOMException("aborted", "AbortError")]);
  await assert.rejects(
    fetchWithRetry(aborted.fetcher, "/api/x", undefined, { attempts: 5, sleep: noWait }),
    { name: "AbortError" },
  );
  assert.equal(aborted.seen.length, 1);
});

test("only same-origin GETs to /api/ and /auth/ are retryable, never /auth/me", () => {
  assert.equal(isRetryableRequest("/api/v1/dashboard/sends", undefined, ORIGIN), true);
  assert.equal(isRetryableRequest("/auth/linkedin/status", { method: "get" }, ORIGIN), true);
  assert.equal(isRetryableRequest(`${ORIGIN}/api/v1/x`, undefined, ORIGIN), true);
  assert.equal(isRetryableRequest(new URL("/api/v1/x", ORIGIN), undefined, ORIGIN), true);
  assert.equal(isRetryableRequest("/api/v1/x", { method: "POST" }, ORIGIN), false);
  assert.equal(isRetryableRequest("/api/v1/x", { method: "DELETE" }, ORIGIN), false);
  assert.equal(
    isRetryableRequest(new Request(`${ORIGIN}/api/v1/x`, { method: "PUT" }), undefined, ORIGIN),
    false,
  );
  assert.equal(isRetryableRequest("/auth/me", undefined, ORIGIN), false);
  assert.equal(isRetryableRequest("https://example.com/api/x", undefined, ORIGIN), false);
  assert.equal(isRetryableRequest("/assets/logo.svg", undefined, ORIGIN), false);
});

test("installFetchRetry wraps GETs and passes writes straight through", async () => {
  const { fetcher, seen } = scripted([503, 200]);
  const target = { fetch: fetcher, location: { origin: ORIGIN } };
  installFetchRetry(target);

  const post = await target.fetch("/api/v1/x", { method: "POST" });
  assert.equal(post.status, 503, "a write is never repeated");
  assert.equal(seen.length, 1);
});
