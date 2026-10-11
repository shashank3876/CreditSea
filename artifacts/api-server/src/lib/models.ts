import mongoose, { Schema, Types, model, type Model } from "mongoose";

export const USER_ROLES = [
  "ADMIN",
  "SALES",
  "SANCTION",
  "DISBURSEMENT",
  "COLLECTION",
  "BORROWER",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const EMPLOYEE_ROLES = [
  "SALES",
  "SANCTION",
  "DISBURSEMENT",
  "COLLECTION",
] as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export const ACCOUNT_STATUSES = ["ACTIVE", "DISABLED"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const EMPLOYMENT_MODES = [
  "SALARIED",
  "SELF_EMPLOYED",
  "UNEMPLOYED",
] as const;
export type EmploymentMode = (typeof EMPLOYMENT_MODES)[number];

export type EligibilityIssue = {
  field: string;
  message: string;
};

export type SalesLeadNote = {
  note: string;
  by: Types.ObjectId;
  name: string;
  at: Date;
};

export interface IUser {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: AccountStatus;
  panEncrypted?: string;
  panLast4?: string;
  dateOfBirth?: Date;
  monthlySalaryRupees?: number;
  employmentMode?: EmploymentMode;
  eligibilityStatus: "NOT_CHECKED" | "ELIGIBLE" | "INELIGIBLE";
  eligibilityErrors: EligibilityIssue[];
  salarySlipId?: Types.ObjectId;
  salesContact?: {
    by: Types.ObjectId;
    name: string;
    at: Date;
  };
  salesNotes: SalesLeadNote[];
  createdAt: Date;
  updatedAt: Date;
}

const eligibilityIssueSchema = new Schema<EligibilityIssue>(
  {
    field: { type: String, required: true },
    message: { type: String, required: true },
  },
  { _id: false },
);

const salesLeadNoteSchema = new Schema<SalesLeadNote>(
  {
    note: { type: String, required: true, trim: true, maxlength: 1000 },
    by: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const salesContactSchema = new Schema<NonNullable<IUser["salesContact"]>>(
  {
    by: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: USER_ROLES, required: true, index: true },
    status: {
      type: String,
      enum: ACCOUNT_STATUSES,
      default: "ACTIVE",
      required: true,
      index: true,
    },
    panEncrypted: { type: String, select: false },
    panLast4: { type: String, select: false },
    dateOfBirth: { type: Date },
    monthlySalaryRupees: { type: Number, min: 0 },
    employmentMode: { type: String, enum: EMPLOYMENT_MODES },
    eligibilityStatus: {
      type: String,
      enum: ["NOT_CHECKED", "ELIGIBLE", "INELIGIBLE"],
      default: "NOT_CHECKED",
      required: true,
    },
    eligibilityErrors: { type: [eligibilityIssueSchema], default: [] },
    salarySlipId: { type: Schema.Types.ObjectId, ref: "SalarySlip" },
    salesContact: { type: salesContactSchema },
    salesNotes: { type: [salesLeadNoteSchema], default: [] },
  },
  { timestamps: true, minimize: false },
);
userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ role: 1, status: 1, createdAt: -1 });

export interface ISalarySlip {
  borrowerId: Types.ObjectId;
  objectKey: string;
  fileName: string;
  contentType: "application/pdf" | "image/jpeg" | "image/png";
  sizeBytes: number;
  uploadedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const salarySlipSchema = new Schema<ISalarySlip>(
  {
    borrowerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    objectKey: { type: String, required: true, select: false },
    fileName: { type: String, required: true, maxlength: 120 },
    contentType: {
      type: String,
      enum: ["application/pdf", "image/jpeg", "image/png"],
      required: true,
    },
    sizeBytes: { type: Number, required: true, min: 1, max: 5 * 1024 * 1024 },
    uploadedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);
salarySlipSchema.index({ borrowerId: 1, uploadedAt: -1 });

export type LoanStatus =
  | "APPLIED"
  | "SANCTIONED"
  | "REJECTED"
  | "DISBURSED"
  | "CLOSED";

export interface ILoan {
  reference: string;
  borrowerId: Types.ObjectId;
  borrowerName: string;
  borrowerEmail: string;
  panMasked: string;
  monthlySalaryRupees: number;
  employmentMode: EmploymentMode;
  salarySlipId: Types.ObjectId;
  principalPaise: number;
  tenureDays: number;
  interestRatePercent: 12;
  interestPaise: number;
  totalRepaymentPaise: number;
  totalPaidPaise: number;
  outstandingBalancePaise: number;
  status: LoanStatus;
  rejectionReason?: string;
  idempotencyKey: string;
  activeBorrower?: Types.ObjectId;
  sanction?: {
    by: Types.ObjectId;
    name: string;
    at: Date;
    note?: string;
  };
  disbursement?: {
    by: Types.ObjectId;
    name: string;
    at: Date;
    amountPaise: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const sanctionSchema = new Schema<NonNullable<ILoan["sanction"]>>(
  {
    by: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    at: { type: Date, required: true },
    note: { type: String, maxlength: 500 },
  },
  { _id: false },
);

const disbursementSchema = new Schema<NonNullable<ILoan["disbursement"]>>(
  {
    by: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    at: { type: Date, required: true },
    amountPaise: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const loanSchema = new Schema<ILoan>(
  {
    reference: { type: String, required: true, unique: true },
    borrowerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    borrowerName: { type: String, required: true },
    borrowerEmail: { type: String, required: true, lowercase: true },
    panMasked: { type: String, required: true },
    monthlySalaryRupees: { type: Number, required: true, min: 0 },
    employmentMode: { type: String, enum: EMPLOYMENT_MODES, required: true },
    salarySlipId: {
      type: Schema.Types.ObjectId,
      ref: "SalarySlip",
      required: true,
    },
    principalPaise: { type: Number, required: true, min: 1 },
    tenureDays: { type: Number, required: true, min: 30, max: 365 },
    interestRatePercent: { type: Number, required: true, enum: [12] },
    interestPaise: { type: Number, required: true, min: 0 },
    totalRepaymentPaise: { type: Number, required: true, min: 1 },
    totalPaidPaise: { type: Number, required: true, min: 0 },
    outstandingBalancePaise: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["APPLIED", "SANCTIONED", "REJECTED", "DISBURSED", "CLOSED"],
      required: true,
      index: true,
    },
    rejectionReason: { type: String, maxlength: 1000 },
    idempotencyKey: { type: String, required: true, maxlength: 100 },
    activeBorrower: { type: Schema.Types.ObjectId, ref: "User" },
    sanction: { type: sanctionSchema },
    disbursement: { type: disbursementSchema },
  },
  { timestamps: true, minimize: false },
);
loanSchema.index({ status: 1, createdAt: -1 });
loanSchema.index({ borrowerId: 1, createdAt: -1 });
loanSchema.index(
  { borrowerId: 1, idempotencyKey: 1 },
  { unique: true, name: "borrower_idempotency_unique" },
);
loanSchema.index(
  { activeBorrower: 1 },
  { unique: true, sparse: true, name: "one_active_loan_per_borrower" },
);

export interface IPayment {
  loanId: Types.ObjectId;
  borrowerId: Types.ObjectId;
  utr: string;
  normalizedUtr: string;
  amountPaise: number;
  paymentDate: Date;
  recordedBy: Types.ObjectId;
  recordedByName: string;
  createdAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    loanId: {
      type: Schema.Types.ObjectId,
      ref: "Loan",
      required: true,
      index: true,
    },
    borrowerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    utr: { type: String, required: true, maxlength: 50 },
    normalizedUtr: { type: String, required: true, maxlength: 50 },
    amountPaise: { type: Number, required: true, min: 1 },
    paymentDate: { type: Date, required: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    recordedByName: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
paymentSchema.index(
  { normalizedUtr: 1 },
  { unique: true, name: "normalized_utr_unique" },
);
paymentSchema.index({ loanId: 1, paymentDate: -1 });

export const User =
  (mongoose.models.User as Model<IUser>) ??
  model<IUser>("User", userSchema);
export const SalarySlip =
  (mongoose.models.SalarySlip as Model<ISalarySlip>) ??
  model<ISalarySlip>("SalarySlip", salarySlipSchema);
export const Loan =
  (mongoose.models.Loan as Model<ILoan>) ??
  model<ILoan>("Loan", loanSchema);
export const Payment =
  (mongoose.models.Payment as Model<IPayment>) ??
  model<IPayment>("Payment", paymentSchema);
