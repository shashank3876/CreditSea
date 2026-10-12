import type { EmploymentMode, UserRole } from "./models";

export type EligibilityInput = {
  dateOfBirth: string;
  monthlySalaryRupees: number;
  employmentMode: EmploymentMode;
  pan: string;
};

export type EligibilityResult = {
  eligible: boolean;
  errors: { field: string; message: string }[];
};

const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function checkEligibility(
  input: EligibilityInput,
  now = new Date(),
): EligibilityResult {
  const errors: EligibilityResult["errors"] = [];
  const pan = input.pan.trim().toUpperCase();

  if (!PAN_PATTERN.test(pan)) {
    errors.push({
      field: "pan",
      message: "Enter a valid 10-character PAN.",
    });
  }

  const dob = new Date(`${input.dateOfBirth}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth) ||
    Number.isNaN(dob.getTime()) ||
    dob.toISOString().slice(0, 10) !== input.dateOfBirth
  ) {
    errors.push({
      field: "dateOfBirth",
      message: "Enter a valid date of birth.",
    });
  } else {
    const age = calculateAge(dob, now);
    if (age < 23 || age > 50) {
      errors.push({
        field: "dateOfBirth",
        message: "Applicants must be between 23 and 50 years old.",
      });
    }
  }

  if (!Number.isInteger(input.monthlySalaryRupees) || input.monthlySalaryRupees < 25_000) {
    errors.push({
      field: "monthlySalaryRupees",
      message: "Monthly salary must be at least ₹25,000.",
    });
  }

  if (input.employmentMode === "UNEMPLOYED") {
    errors.push({
      field: "employmentMode",
      message: "Applicants must be employed.",
    });
  }

  return { eligible: errors.length === 0, errors };
}

function calculateAge(dateOfBirth: Date, now: Date): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (now.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      now.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export function maskPan(pan: string): string {
  const normalized = pan.trim().toUpperCase();
  return normalized.length === 10
    ? `${normalized.slice(0, 2)}••••••${normalized.slice(-2)}`
    : "••••••••••";
}

export function calculateLoanAmounts(
  principalRupees: number,
  tenureDays: number,
): {
  principalPaise: number;
  interestPaise: number;
  totalRepaymentPaise: number;
} {
  if (
    !Number.isInteger(principalRupees) ||
    principalRupees < 50_000 ||
    principalRupees > 500_000
  ) {
    throw new RangeError("Loan amount must be between ₹50,000 and ₹5,00,000.");
  }
  if (!Number.isInteger(tenureDays) || tenureDays < 30 || tenureDays > 365) {
    throw new RangeError("Loan tenure must be between 30 and 365 days.");
  }

  const principalPaise = principalRupees * 100;
  const interestPaise = Math.round(
    (principalPaise * 12 * tenureDays) / (100 * 365),
  );
  return {
    principalPaise,
    interestPaise,
    totalRepaymentPaise: principalPaise + interestPaise,
  };
}

export function normalizeUtr(utr: string): string {
  return utr.trim().toUpperCase().replace(/[\s-]+/g, "");
}

export function validateUtr(utr: string): string {
  const normalized = normalizeUtr(utr);
  if (!/^[A-Z0-9]{6,50}$/.test(normalized)) {
    throw new RangeError(
      "UTR must contain 6 to 50 letters or numbers after removing spaces and hyphens.",
    );
  }
  return normalized;
}

export function utcCalendarDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Date-only payment inputs (YYYY-MM-DD) parse as UTC midnight; compare by calendar day. */
export function isPaymentBeforeDisbursement(
  paymentDate: Date,
  disbursedAt: Date,
): boolean {
  return utcCalendarDay(paymentDate) < utcCalendarDay(disbursedAt);
}

export function validatePayment(
  amountPaise: number,
  outstandingBalancePaise: number,
  paymentDate: Date,
  now = new Date(),
): void {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new RangeError("Payment amount must be a positive whole number of paise.");
  }
  if (amountPaise > outstandingBalancePaise) {
    throw new RangeError("Payment cannot exceed the outstanding balance.");
  }
  if (Number.isNaN(paymentDate.getTime())) {
    throw new RangeError("Payment date must be valid.");
  }
  if (utcCalendarDay(paymentDate) > utcCalendarDay(now)) {
    throw new RangeError("Payment date cannot be in the future.");
  }
}

export function canTransitionLoan(
  current: string,
  next: string,
): boolean {
  const transitions: Record<string, readonly string[]> = {
    APPLIED: ["SANCTIONED", "REJECTED"],
    SANCTIONED: ["DISBURSED"],
    DISBURSED: ["CLOSED"],
    REJECTED: [],
    CLOSED: [],
  };
  return transitions[current]?.includes(next) ?? false;
}

export const ASSIGNABLE_EMPLOYEE_ROLES = [
  "SALES",
  "SANCTION",
  "DISBURSEMENT",
  "COLLECTION",
] as const;

export type AssignableEmployeeRole = (typeof ASSIGNABLE_EMPLOYEE_ROLES)[number];

export function isAssignableEmployeeRole(
  role: string,
): role is AssignableEmployeeRole {
  return (ASSIGNABLE_EMPLOYEE_ROLES as readonly string[]).includes(role);
}

export function canAccessRole(
  role: UserRole,
  area:
    | "sales"
    | "sanction"
    | "disbursement"
    | "collection"
    | "dashboard"
    | "employees",
): boolean {
  const roleAccess: Record<typeof area, readonly UserRole[]> = {
    sales: ["ADMIN", "SALES"],
    sanction: ["ADMIN", "SANCTION"],
    disbursement: ["ADMIN", "DISBURSEMENT"],
    collection: ["ADMIN", "COLLECTION"],
    dashboard: ["ADMIN", "SALES", "SANCTION", "DISBURSEMENT", "COLLECTION"],
    employees: ["ADMIN"],
  };
  return roleAccess[area].includes(role);
}
