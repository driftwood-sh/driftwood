import assert from "node:assert/strict";
import test from "node:test";

import { isReconnecting } from "./connection-status.ts";
import { clearIdentity, isSignedOut, loadIdentity } from "./identity.ts";

const KEY = "driftwood.dashboard.me";

type TestUser = {
  email: string;
  is_approved: boolean;
  name?: string;
};

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
    dump() {
      return Object.fromEntries(values);
    },
  };
}

function okFetcher(user: TestUser) {
  return async () =>
    new Response(JSON.stringify(user), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
}

const APPROVED: TestUser = { email: "anna@example.com", is_approved: true };
const RENAMED: TestUser = {
  email: "anna@example.com",
  is_approved: true,
  name: "Anna",
};

test("cached identity is returned immediately and revalidated in the background", async () => {
  const storage = memoryStorage({ [KEY]: JSON.stringify(APPROVED) });
  const { cached, fresh } = loadIdentity<TestUser>({
    fetcher: okFetcher(RENAMED),
    storage,
    mock: false,
  });
  assert.deepEqual(cached, APPROVED);
  assert.deepEqual(await fresh, RENAMED);
  // The cache now holds the fresh payload for the next page load.
  assert.deepEqual(JSON.parse(storage.dump()[KEY]), RENAMED);
});

test("no cache means a null cached user, then the fresh result fills the cache", async () => {
  const storage = memoryStorage();
  const { cached, fresh } = loadIdentity<TestUser>({
    fetcher: okFetcher(APPROVED),
    storage,
    mock: false,
  });
  assert.equal(cached, null);
  assert.deepEqual(await fresh, APPROVED);
  assert.deepEqual(JSON.parse(storage.dump()[KEY]), APPROVED);
});

test("a 401 resolves null and clears the cache", async () => {
  const storage = memoryStorage({ [KEY]: JSON.stringify(APPROVED) });
  const { cached, fresh } = loadIdentity<TestUser>({
    fetcher: async () => new Response("", { status: 401 }),
    storage,
    mock: false,
  });
  assert.deepEqual(cached, APPROVED); // stale paint is allowed…
  assert.equal(await fresh, null); // …but the revalidation says no
  assert.equal(storage.dump()[KEY], undefined);
});

test("a 403 also resolves null and clears the cache", async () => {
  const storage = memoryStorage({ [KEY]: JSON.stringify(APPROVED) });
  const { fresh } = loadIdentity<TestUser>({
    fetcher: async () => new Response("", { status: 403 }),
    storage,
    mock: false,
  });
  assert.equal(await fresh, null);
  assert.equal(storage.dump()[KEY], undefined);
});

test("only 401 and 403 count as signed out", () => {
  assert.equal(isSignedOut(401), true);
  assert.equal(isSignedOut(403), true);
  for (const status of [200, 404, 429, 500, 502, 503, 504]) {
    assert.equal(isSignedOut(status), false, `status ${status}`);
  }
});

/* A fetcher that answers from a script, one entry per call. */
function scripted(steps: Array<Response | Error>) {
  let calls = 0;
  const fetcher = async () => {
    const step = steps[Math.min(calls, steps.length - 1)];
    calls += 1;
    if (step instanceof Error) throw step;
    return step.clone();
  };
  return { fetcher, calls: () => calls };
}

function json(user: TestUser): Response {
  return new Response(JSON.stringify(user), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("429, 503 and network errors retry instead of signing the user out", async () => {
  const storage = memoryStorage({ [KEY]: JSON.stringify(APPROVED) });
  const waits: number[] = [];
  const reconnectingDuringWait: boolean[] = [];
  const script = scripted([
    new Response("", { status: 429, headers: { "Retry-After": "3" } }),
    new Response("", { status: 503 }),
    new TypeError("Failed to fetch"),
    json(RENAMED),
  ]);
  const { fresh } = loadIdentity<TestUser>({
    fetcher: script.fetcher,
    storage,
    mock: false,
    sleep: async (ms) => {
      waits.push(ms);
      reconnectingDuringWait.push(isReconnecting());
      // The cached user survives every transient failure.
      assert.deepEqual(JSON.parse(storage.dump()[KEY]), APPROVED);
    },
  });
  assert.deepEqual(await fresh, RENAMED);
  assert.equal(script.calls(), 4);
  assert.equal(waits[0], 3000, "Retry-After is honored");
  assert.equal(waits.length, 3);
  assert.deepEqual(reconnectingDuringWait, [true, true, true]);
  assert.equal(isReconnecting(), false, "the notice clears once /auth/me answers");
});

test("a retry that ends in 401 still signs the user out", async () => {
  const storage = memoryStorage({ [KEY]: JSON.stringify(APPROVED) });
  const script = scripted([
    new Response("", { status: 503 }),
    new Response("", { status: 401 }),
  ]);
  const { fresh } = loadIdentity<TestUser>({
    fetcher: script.fetcher,
    storage,
    mock: false,
    sleep: async () => {},
  });
  assert.equal(await fresh, null);
  assert.equal(storage.dump()[KEY], undefined);
  assert.equal(isReconnecting(), false);
});

test("a corrupt or non-user cache entry is dropped instead of painted", async () => {
  for (const raw of ["not json", '"a string"', '{"email":5}', "null"]) {
    const storage = memoryStorage({ [KEY]: raw });
    const { cached, fresh } = loadIdentity<TestUser>({
      fetcher: okFetcher(APPROVED),
      storage,
      mock: false,
    });
    assert.equal(cached, null, `cached should be null for ${raw}`);
    await fresh;
  }
});

test("mock mode bypasses the cache entirely — no reads, no writes", async () => {
  const real = JSON.stringify(APPROVED);
  const storage = memoryStorage({ [KEY]: real });
  const mockUser: TestUser = { email: "marc@a16z.com", is_approved: true };
  const { cached, fresh } = loadIdentity<TestUser>({
    fetcher: okFetcher(mockUser),
    storage,
    mock: true,
  });
  assert.equal(cached, null); // the real cache never seeds a mock page
  assert.deepEqual(await fresh, mockUser);
  // The mock session left the real identity untouched.
  assert.equal(storage.dump()[KEY], real);
});

test("mock mode never clears the real cache on an auth failure", async () => {
  const real = JSON.stringify(APPROVED);
  const storage = memoryStorage({ [KEY]: real });
  const { fresh } = loadIdentity<TestUser>({
    fetcher: async () => new Response("", { status: 401 }),
    storage,
    mock: true,
  });
  assert.equal(await fresh, null);
  assert.equal(storage.dump()[KEY], real);
});

test("clearIdentity removes the cached user", () => {
  const storage = memoryStorage({ [KEY]: JSON.stringify(APPROVED) });
  clearIdentity(storage);
  assert.equal(storage.dump()[KEY], undefined);
});
