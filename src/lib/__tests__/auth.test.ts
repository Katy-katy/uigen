// @vitest-environment node
import { test, expect, vi, beforeEach } from "vitest";
import { SignJWT } from "jose";

vi.mock("server-only", () => ({}));

const cookieStore = new Map<string, { value: string }>();
const mockCookies = {
  get: vi.fn((name: string) => cookieStore.get(name)),
  set: vi.fn((name: string, value: string) => {
    cookieStore.set(name, { value });
  }),
  delete: vi.fn((name: string) => {
    cookieStore.delete(name);
  }),
};

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve(mockCookies),
}));

const {
  createSession,
  getSession,
  deleteSession,
  verifySession,
} = await import("@/lib/auth");

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "development-secret-key"
);

beforeEach(() => {
  cookieStore.clear();
  mockCookies.get.mockClear();
  mockCookies.set.mockClear();
  mockCookies.delete.mockClear();
});

test("createSession writes an httpOnly auth-token cookie", async () => {
  await createSession("user-1", "alice@example.com");

  expect(mockCookies.set).toHaveBeenCalledTimes(1);
  const [name, token, opts] = mockCookies.set.mock.calls[0] as [
    string,
    string,
    any,
  ];

  expect(name).toBe("auth-token");
  expect(typeof token).toBe("string");
  expect(token.split(".")).toHaveLength(3); // header.payload.signature
  expect(opts).toMatchObject({
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  expect(opts.expires).toBeInstanceOf(Date);
  // Expiry should be roughly 7 days out
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const delta = opts.expires.getTime() - Date.now();
  expect(delta).toBeGreaterThan(sevenDaysMs - 5_000);
  expect(delta).toBeLessThan(sevenDaysMs + 5_000);
});

test("getSession returns null when no cookie is present", async () => {
  const session = await getSession();
  expect(session).toBeNull();
});

test("getSession returns null when the cookie token is malformed", async () => {
  cookieStore.set("auth-token", { value: "not-a-real-jwt" });
  const session = await getSession();
  expect(session).toBeNull();
});

test("getSession returns the payload after createSession", async () => {
  await createSession("user-42", "bob@example.com");

  const session = await getSession();
  expect(session).not.toBeNull();
  expect(session?.userId).toBe("user-42");
  expect(session?.email).toBe("bob@example.com");
});

test("getSession returns null for a token signed with a different secret", async () => {
  const wrongSecret = new TextEncoder().encode("not-the-right-secret");
  const token = await new SignJWT({ userId: "x", email: "x@x" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .setIssuedAt()
    .sign(wrongSecret);
  cookieStore.set("auth-token", { value: token });

  const session = await getSession();
  expect(session).toBeNull();
});

test("getSession returns null for an expired token", async () => {
  const token = await new SignJWT({ userId: "x", email: "x@x" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60) // 60s ago
    .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
    .sign(JWT_SECRET);
  cookieStore.set("auth-token", { value: token });

  const session = await getSession();
  expect(session).toBeNull();
});

test("deleteSession removes the auth-token cookie", async () => {
  await createSession("user-1", "alice@example.com");
  expect(cookieStore.has("auth-token")).toBe(true);

  await deleteSession();

  expect(mockCookies.delete).toHaveBeenCalledWith("auth-token");
  expect(cookieStore.has("auth-token")).toBe(false);
});

function makeRequest(token?: string) {
  return {
    cookies: {
      get: (name: string) =>
        token && name === "auth-token" ? { value: token } : undefined,
    },
  } as any;
}

test("verifySession returns null when the request has no cookie", async () => {
  const session = await verifySession(makeRequest());
  expect(session).toBeNull();
});

test("verifySession returns null for an invalid token on the request", async () => {
  const session = await verifySession(makeRequest("garbage"));
  expect(session).toBeNull();
});

test("verifySession returns the payload for a valid token on the request", async () => {
  const token = await new SignJWT({
    userId: "user-99",
    email: "carol@example.com",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .setIssuedAt()
    .sign(JWT_SECRET);

  const session = await verifySession(makeRequest(token));
  expect(session).not.toBeNull();
  expect(session?.userId).toBe("user-99");
  expect(session?.email).toBe("carol@example.com");
});
