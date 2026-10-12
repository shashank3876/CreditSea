import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateLoanAmounts,
  canAccessRole,
  canTransitionLoan,
  checkEligibility,
  isAssignableEmployeeRole,
  isPaymentBeforeDisbursement,
  normalizeUtr,
  validatePayment,
  validateUtr,
} from "./domain";
import {
  expectedSalarySlipContentType,
  MAX_SALARY_SLIP_BYTES,
  validateSalarySlipFile,
} from "./uploadValidation";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const VALID_PROFILE = {
  dateOfBirth: "1990-03-12",
  monthlySalaryRupees: 25_000,
  employmentMode: "SALARIED" as const,
  pan: "ABCDE1234F",
};

test("eligibility accepts the exact minimum salary and valid employed profile", () => {
  assert.deepEqual(checkEligibility(VALID_PROFILE, NOW), {
    eligible: true,
    errors: [],
  });
});

test("eligibility accepts applicants on the 23rd and 50th birthdays", () => {
  assert.equal(
    checkEligibility(
      { ...VALID_PROFILE, dateOfBirth: "2003-10-10" },
      NOW,
    ).eligible,
    true,
  );
  assert.equal(
    checkEligibility(
      { ...VALID_PROFILE, dateOfBirth: "1976-10-10" },
      NOW,
    ).eligible,
    true,
  );
});

test("eligibility rejects applicants below 23 or over 50", () => {
  const underAge = checkEligibility(
    { ...VALID_PROFILE, dateOfBirth: "2003-10-11" },
    NOW,
  );
  const overAge = checkEligibility(
    { ...VALID_PROFILE, dateOfBirth: "1975-10-09" },
    NOW,
  );
  assert.equal(underAge.eligible, false);
  assert.equal(underAge.errors[0]?.field, "dateOfBirth");
  assert.equal(overAge.eligible, false);
  assert.equal(overAge.errors[0]?.field, "dateOfBirth");
});

test("eligibility does not count a birthday that has not occurred yet this year", () => {
  const result = checkEligibility(
    { ...VALID_PROFILE, dateOfBirth: "2003-10-11" },
    NOW,
  );
  assert.equal(result.eligible, false);
});

test("eligibility rejects salary below ₹25,000", () => {
  const result = checkEligibility(
    { ...VALID_PROFILE, monthlySalaryRupees: 24_999 },
    NOW,
  );
  assert.equal(result.eligible, false);
  assert.equal(result.errors[0]?.field, "monthlySalaryRupees");
});

test("eligibility rejects unemployed applicants", () => {
  const result = checkEligibility(
    { ...VALID_PROFILE, employmentMode: "UNEMPLOYED" },
    NOW,
  );
  assert.equal(result.eligible, false);
  assert.equal(result.errors.some((error) => error.field === "employmentMode"), true);
});

test("eligibility rejects malformed PAN and invalid calendar dates", () => {
  const result = checkEligibility(
    { ...VALID_PROFILE, pan: "bad-pan", dateOfBirth: "1990-02-30" },
    NOW,
  );
  assert.equal(result.eligible, false);
  assert.equal(result.errors.some((error) => error.field === "pan"), true);
  assert.equal(result.errors.some((error) => error.field === "dateOfBirth"), true);
});

test("loan calculation rounds annual simple interest to the nearest paise", () => {
  assert.deepEqual(calculateLoanAmounts(50_000, 30), {
    principalPaise: 5_000_000,
    interestPaise: 49_315,
    totalRepaymentPaise: 5_049_315,
  });
});

test("loan calculation accepts maximum principal and tenure", () => {
  assert.deepEqual(calculateLoanAmounts(500_000, 365), {
    principalPaise: 50_000_000,
    interestPaise: 6_000_000,
    totalRepaymentPaise: 56_000_000,
  });
});

test("loan calculation rejects principal or tenure outside the product limits", () => {
  assert.throws(() => calculateLoanAmounts(49_999, 30), RangeError);
  assert.throws(() => calculateLoanAmounts(500_001, 30), RangeError);
  assert.throws(() => calculateLoanAmounts(100_000, 29), RangeError);
  assert.throws(() => calculateLoanAmounts(100_000, 366), RangeError);
});

test("UTR normalization makes case, whitespace, and hyphen variants equivalent", () => {
  assert.equal(normalizeUtr(" abC-123 "), "ABC123");
  assert.equal(validateUtr(" abC-123 "), validateUtr("ABC 123"));
});

test("UTR validation rejects short and punctuated identifiers", () => {
  assert.throws(() => validateUtr("ABC12"), RangeError);
  assert.throws(() => validateUtr("ABC_123"), RangeError);
});

test("payment-vs-disbursement compares calendar days, not clock time", () => {
  const disbursedAt = new Date("2026-10-12T06:19:03.166Z");
  // Date-only form values parse as UTC midnight on that day.
  assert.equal(
    isPaymentBeforeDisbursement(new Date("2026-10-12"), disbursedAt),
    false,
  );
  assert.equal(
    isPaymentBeforeDisbursement(new Date("2026-10-11"), disbursedAt),
    true,
  );
  assert.equal(
    isPaymentBeforeDisbursement(new Date("2026-10-13T00:00:00.000Z"), disbursedAt),
    false,
  );
});

test("payment validation allows a positive payment up to the outstanding balance", () => {
  assert.doesNotThrow(() =>
    validatePayment(1_000, 10_000, new Date("2026-10-09T15:00:00.000Z"), NOW),
  );
  assert.doesNotThrow(() =>
    validatePayment(10_000, 10_000, new Date("2026-10-10T00:00:00.000Z"), NOW),
  );
});

test("payment validation rejects zero, overpayment, invalid dates, and future dates", () => {
  assert.throws(
    () => validatePayment(0, 10_000, new Date("2026-10-09T00:00:00.000Z"), NOW),
    RangeError,
  );
  assert.throws(
    () => validatePayment(10_001, 10_000, new Date("2026-10-09T00:00:00.000Z"), NOW),
    RangeError,
  );
  assert.throws(
    () => validatePayment(1, 10_000, new Date(Number.NaN), NOW),
    RangeError,
  );
  assert.throws(
    () => validatePayment(1, 10_000, new Date("2026-10-11T00:00:00.000Z"), NOW),
    RangeError,
  );
});

test("loan lifecycle only allows the intended forward transitions", () => {
  assert.equal(canTransitionLoan("APPLIED", "SANCTIONED"), true);
  assert.equal(canTransitionLoan("APPLIED", "REJECTED"), true);
  assert.equal(canTransitionLoan("SANCTIONED", "DISBURSED"), true);
  assert.equal(canTransitionLoan("DISBURSED", "CLOSED"), true);
  assert.equal(canTransitionLoan("REJECTED", "SANCTIONED"), false);
  assert.equal(canTransitionLoan("CLOSED", "DISBURSED"), false);
  assert.equal(canTransitionLoan("APPLIED", "DISBURSED"), false);
});

test("only Sales, Sanction, Disbursement, and Collection roles are assignable to employees", () => {
  for (const role of ["SALES", "SANCTION", "DISBURSEMENT", "COLLECTION"] as const) {
    assert.equal(isAssignableEmployeeRole(role), true);
  }
  assert.equal(isAssignableEmployeeRole("ADMIN"), false);
  assert.equal(isAssignableEmployeeRole("BORROWER"), false);
  assert.equal(isAssignableEmployeeRole("HACKER"), false);
});

test("each staff role is limited to its own operations area and admins can access all", () => {
  assert.equal(canAccessRole("SALES", "sales"), true);
  assert.equal(canAccessRole("SALES", "sanction"), false);
  assert.equal(canAccessRole("SANCTION", "sanction"), true);
  assert.equal(canAccessRole("SANCTION", "collection"), false);
  assert.equal(canAccessRole("DISBURSEMENT", "disbursement"), true);
  assert.equal(canAccessRole("COLLECTION", "collection"), true);
  assert.equal(canAccessRole("ADMIN", "employees"), true);
  assert.equal(canAccessRole("SALES", "employees"), false);
  for (const area of [
    "sales",
    "sanction",
    "disbursement",
    "collection",
    "dashboard",
    "employees",
  ] as const) {
    assert.equal(canAccessRole("ADMIN", area), true);
    assert.equal(canAccessRole("BORROWER", area), false);
  }
});

test("salary-slip validation accepts a matching PDF signature and safe filename", () => {
  assert.equal(expectedSalarySlipContentType("../../salary slip.PDF"), "application/pdf");
  assert.deepEqual(
    validateSalarySlipFile({
      originalName: "../../salary slip.PDF",
      contentType: "application/pdf",
      sizeBytes: 16,
      contents: Buffer.from("%PDF-1.7 test"),
    }),
    {
      contentType: "application/pdf",
      fileName: "salary_slip.PDF",
    },
  );
});

test("salary-slip validation accepts PNG and JPEG signatures", () => {
  const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  assert.equal(
    validateSalarySlipFile({
      originalName: "slip.png",
      contentType: "image/png",
      sizeBytes: pngHeader.length,
      contents: pngHeader,
    }).contentType,
    "image/png",
  );
  assert.equal(
    validateSalarySlipFile({
      originalName: "slip.jpg",
      contentType: "image/jpeg",
      sizeBytes: jpegHeader.length,
      contents: jpegHeader,
    }).contentType,
    "image/jpeg",
  );
});

test("salary-slip validation rejects spoofed, unsupported, and oversized files", () => {
  assert.throws(
    () =>
      validateSalarySlipFile({
        originalName: "slip.pdf",
        contentType: "application/pdf",
        sizeBytes: 8,
        contents: Buffer.from("not a pdf"),
      }),
    RangeError,
  );
  assert.throws(
    () =>
      validateSalarySlipFile({
        originalName: "slip.exe",
        contentType: "application/octet-stream",
        sizeBytes: 8,
        contents: Buffer.from("MZ"),
      }),
    RangeError,
  );
  assert.throws(
    () =>
      validateSalarySlipFile({
        originalName: "slip.pdf.exe",
        contentType: "application/pdf",
        sizeBytes: 16,
        contents: Buffer.from("%PDF-1.7 test"),
      }),
    RangeError,
  );
  assert.throws(
    () =>
      validateSalarySlipFile({
        originalName: "slip.pdf",
        contentType: "application/pdf",
        sizeBytes: MAX_SALARY_SLIP_BYTES + 1,
        contents: Buffer.from("%PDF-"),
      }),
    RangeError,
  );
});
