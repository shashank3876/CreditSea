import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import {
  enforceSameOriginForCookieWrites,
  requireRole,
  SESSION_COOKIE,
} from "./security";

function roleRequest(role?: "ADMIN" | "SALES" | "SANCTION" | "DISBURSEMENT" | "COLLECTION" | "BORROWER") {
  return {
    currentUser: role
      ? {
          id: "user-id",
          name: "Test User",
          email: "user@creditsea.test",
          role,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        }
      : undefined,
  } as unknown as Request;
}

function responseRecorder() {
  let statusCode = 200;
  let body: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
  } as unknown as Response;
  return {
    response,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
}

test("role middleware allows a matching role", () => {
  let calledNext = false;
  const recorder = responseRecorder();
  requireRole("SANCTION")(
    roleRequest("SANCTION"),
    recorder.response,
    () => {
      calledNext = true;
    },
  );
  assert.equal(calledNext, true);
  assert.equal(recorder.statusCode, 200);
});

test("role middleware rejects another staff role and borrowers", () => {
  for (const role of ["SALES", "BORROWER"] as const) {
    const recorder = responseRecorder();
    requireRole("SANCTION")(
      roleRequest(role),
      recorder.response,
      () => assert.fail("A role without sanction access must not continue"),
    );
    assert.equal(recorder.statusCode, 403);
  }
});

test("role middleware rejects requests without an authenticated user", () => {
  const recorder = responseRecorder();
  requireRole("COLLECTION")(
    roleRequest(),
    recorder.response,
    () => assert.fail("An unauthenticated request must not continue"),
  );
  assert.equal(recorder.statusCode, 401);
});

function csrfRequest(options: {
  origin?: string;
  cookie?: string;
  host?: string;
  protocol?: string;
}) {
  const headers: Record<string, string | undefined> = {
    origin: options.origin,
    host: options.host ?? "app.creditsea.test",
    "x-forwarded-host": options.host ?? "app.creditsea.test",
    "x-forwarded-proto": options.protocol ?? "https",
  };
  return {
    method: "POST",
    protocol: options.protocol ?? "https",
    cookies: options.cookie ? { [SESSION_COOKIE]: options.cookie } : {},
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

test("same-origin guard accepts a cookie-authenticated same-origin write", () => {
  let calledNext = false;
  const recorder = responseRecorder();
  enforceSameOriginForCookieWrites(
    csrfRequest({
      origin: "https://app.creditsea.test",
      cookie: "session",
    }),
    recorder.response,
    () => {
      calledNext = true;
    },
  );
  assert.equal(calledNext, true);
});

test("same-origin guard rejects cross-origin and origin-less cookie writes", () => {
  for (const origin of ["https://attacker.example", undefined]) {
    const recorder = responseRecorder();
    enforceSameOriginForCookieWrites(
      csrfRequest({ origin, cookie: "session" }),
      recorder.response,
      () => assert.fail("An unverified cookie write must not continue"),
    );
    assert.equal(recorder.statusCode, 403);
  }
});

test("same-origin guard leaves unauthenticated sign-up and sign-in requests available", () => {
  let calledNext = false;
  const recorder = responseRecorder();
  enforceSameOriginForCookieWrites(
    csrfRequest({ origin: "https://attacker.example" }),
    recorder.response,
    () => {
      calledNext = true;
    },
  );
  assert.equal(calledNext, true);
});
