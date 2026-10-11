import type { HydratedDocument } from "mongoose";
import type { ILoan, IPayment, ISalarySlip, IUser } from "./models";
import { decryptPan } from "./security";

export function userDto(
  user: HydratedDocument<IUser> | (IUser & { _id: { toString(): string } }),
) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status ?? "ACTIVE",
    createdAt: user.createdAt,
  };
}

export function leadDto(
  user: HydratedDocument<IUser> | (IUser & { _id: { toString(): string } }),
) {
  const notes = [...(user.salesNotes ?? [])]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 20)
    .map((entry) => ({
      note: entry.note,
      recordedBy: entry.name,
      recordedAt: entry.at,
    }));
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    registeredAt: user.createdAt,
    status: "REGISTERED_NOT_APPLIED" as const,
    contactedAt: user.salesContact?.at ?? null,
    contactedBy: user.salesContact?.name ?? null,
    notes,
  };
}

export function employeeDto(
  user: HydratedDocument<IUser> | (IUser & { _id: { toString(): string } }),
) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role as
      | "ADMIN"
      | "SALES"
      | "SANCTION"
      | "DISBURSEMENT"
      | "COLLECTION",
    status: user.status ?? "ACTIVE",
    createdAt: user.createdAt,
  };
}

export function profileDto(
  user: HydratedDocument<IUser>,
  salarySlip: HydratedDocument<ISalarySlip> | null,
) {
  const pan = user.panEncrypted ? decryptPan(user.panEncrypted) : null;
  return {
    name: user.name,
    email: user.email,
    panMasked: pan ? maskPan(pan) : null,
    dateOfBirth: user.dateOfBirth
      ? user.dateOfBirth.toISOString().slice(0, 10)
      : null,
    monthlySalaryRupees: user.monthlySalaryRupees ?? null,
    employmentMode: user.employmentMode ?? null,
    eligibilityStatus: user.eligibilityStatus,
    eligibilityErrors: user.eligibilityErrors ?? [],
    salarySlip: salarySlip
      ? {
          id: salarySlip._id.toString(),
          fileName: salarySlip.fileName,
          contentType: salarySlip.contentType,
          sizeBytes: salarySlip.sizeBytes,
          uploadedAt: salarySlip.uploadedAt,
        }
      : null,
  };
}

export function salarySlipDto(salarySlip: HydratedDocument<ISalarySlip>) {
  return {
    id: salarySlip._id.toString(),
    fileName: salarySlip.fileName,
    contentType: salarySlip.contentType,
    sizeBytes: salarySlip.sizeBytes,
    uploadedAt: salarySlip.uploadedAt,
  };
}

export function loanDto(loan: HydratedDocument<ILoan>) {
  return {
    id: loan._id.toString(),
    reference: loan.reference,
    borrowerId: loan.borrowerId.toString(),
    borrowerName: loan.borrowerName,
    borrowerEmail: loan.borrowerEmail,
    principalPaise: loan.principalPaise,
    tenureDays: loan.tenureDays,
    interestRatePercent: loan.interestRatePercent,
    interestPaise: loan.interestPaise,
    totalRepaymentPaise: loan.totalRepaymentPaise,
    totalPaidPaise: loan.totalPaidPaise,
    outstandingBalancePaise: loan.outstandingBalancePaise,
    status: loan.status,
    rejectionReason: loan.rejectionReason ?? null,
    panMasked: loan.panMasked,
    monthlySalaryRupees: loan.monthlySalaryRupees,
    employmentMode: loan.employmentMode,
    salarySlipAvailable: Boolean(loan.salarySlipId),
    sanctionedAt: loan.sanction?.at ?? null,
    sanctionedBy: loan.sanction?.name ?? null,
    disbursedAt: loan.disbursement?.at ?? null,
    disbursedBy: loan.disbursement?.name ?? null,
    createdAt: loan.createdAt,
    updatedAt: loan.updatedAt,
  };
}

export function paymentDto(payment: HydratedDocument<IPayment>) {
  return {
    id: payment._id.toString(),
    loanId: payment.loanId.toString(),
    borrowerId: payment.borrowerId.toString(),
    utr: payment.utr,
    amountPaise: payment.amountPaise,
    paymentDate: payment.paymentDate,
    recordedBy: payment.recordedByName,
    createdAt: payment.createdAt,
  };
}

export function maskPan(pan: string): string {
  const normalized = pan.trim().toUpperCase();
  return normalized.length === 10
    ? `${normalized.slice(0, 2)}••••••${normalized.slice(-2)}`
    : "••••••••••";
}
