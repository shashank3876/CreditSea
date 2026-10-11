import assert from "node:assert/strict";
import test from "node:test";
import { CreateEmployeeBody, SignUpBody } from "@workspace/api-zod";

test("public signup input never accepts a client-supplied role", () => {
  const result = SignUpBody.safeParse({
    name: "Borrower User",
    email: "borrower@example.com",
    password: "password12345",
    role: "ADMIN",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(
      "role" in result.data,
      false,
      "Signup must strip or ignore any client-supplied role",
    );
  }
});

test("employee creation accepts only internal queue roles", () => {
  for (const role of ["SALES", "SANCTION", "DISBURSEMENT", "COLLECTION"] as const) {
    const result = CreateEmployeeBody.safeParse({
      name: "Staff Member",
      email: `${role.toLowerCase()}@example.com`,
      password: "password12345",
      role,
    });
    assert.equal(result.success, true, `${role} should be assignable`);
  }

  for (const role of ["ADMIN", "BORROWER", "SUPERUSER"] as const) {
    const result = CreateEmployeeBody.safeParse({
      name: "Staff Member",
      email: "staff@example.com",
      password: "password12345",
      role,
    });
    assert.equal(result.success, false, `${role} must not be assignable via create`);
  }
});
