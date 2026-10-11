import mongoose from "mongoose";
import { Router } from "express";
import {
  AddSalesLeadNoteBody,
  AddSalesLeadNoteParams,
  AddSalesLeadNoteResponse,
  ApproveLoanBody,
  ApproveLoanParams,
  ApproveLoanResponse,
  DisburseLoanBody,
  DisburseLoanParams,
  DisburseLoanResponse,
  DownloadSanctionSalarySlipParams,
  GetDashboardStatsResponse,
  ListCollectionLoansQueryParams,
  ListCollectionLoansResponse,
  ListDisbursementLoansQueryParams,
  ListDisbursementLoansResponse,
  ListLoanPaymentsParams,
  ListLoanPaymentsResponse,
  ListSalesLeadsQueryParams,
  ListSalesLeadsResponse,
  ListSanctionLoansQueryParams,
  ListSanctionLoansResponse,
  RecordLoanPaymentBody,
  RecordLoanPaymentParams,
  RecordLoanPaymentResponse,
  RejectLoanBody,
  RejectLoanParams,
  RejectLoanResponse,
} from "@workspace/api-zod";
import {
  canAccessRole,
  validatePayment,
  validateUtr,
} from "../lib/domain";
import { leadDto, loanDto, paymentDto } from "../lib/dto";
import { HttpError } from "../lib/errors";
import {
  Loan,
  Payment,
  SalarySlip,
  User,
  type ILoan,
} from "../lib/models";
import { streamPrivateObject } from "../lib/privateStorage";
import { requireAuth, requireRole } from "../lib/security";
import { validate } from "../lib/validation";

const router = Router();
const STAFF_ROLES = [
  "ADMIN",
  "SALES",
  "SANCTION",
  "DISBURSEMENT",
  "COLLECTION",
] as const;

function escapedRegex(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

function loanSearch(search: string | undefined) {
  if (!search) return {};
  const pattern = escapedRegex(search.trim());
  return {
    $or: [
      { reference: pattern },
      { borrowerName: pattern },
      { borrowerEmail: pattern },
    ],
  };
}

async function listLoans(
  status: "APPLIED" | "SANCTIONED" | "DISBURSED" | "CLOSED",
  query: { page: number; pageSize: number; search?: string },
) {
  const filter = {
    status,
    ...loanSearch(query.search),
  };
  const [items, total] = await Promise.all([
    Loan.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .exec(),
    Loan.countDocuments(filter),
  ]);
  return {
    items: items.map(loanDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

async function throwTransitionError(id: string, entityName: string): Promise<never> {
  const exists = await Loan.exists({ _id: id });
  if (!exists) throw new HttpError(404, `${entityName} not found.`, "NOT_FOUND");
  throw new HttpError(
    409,
    `${entityName} is no longer in a state that allows this action.`,
    "INVALID_STATE",
  );
}

router.get(
  "/operations/dashboard/stats",
  requireAuth,
  requireRole(...STAFF_ROLES),
  async (req, res) => {
    if (!canAccessRole(req.currentUser!.role, "dashboard")) {
      throw new HttpError(403, "You do not have access to this area.", "FORBIDDEN");
    }
    const [borrowers, appliedBorrowers, statusCounts, outstanding] =
      await Promise.all([
        User.countDocuments({ role: "BORROWER" }),
        Loan.distinct("borrowerId"),
        Loan.aggregate<{ _id: string; count: number }>([
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        Loan.aggregate<{ total: number }>([
          { $match: { status: "DISBURSED" } },
          { $group: { _id: null, total: { $sum: "$outstandingBalancePaise" } } },
        ]),
      ]);
    const counts = new Map(statusCounts.map((row) => [row._id, row.count]));
    res.json(
      GetDashboardStatsResponse.parse({
        borrowers,
        unappliedLeads: await User.countDocuments({
          role: "BORROWER",
          _id: { $nin: appliedBorrowers },
        }),
        applied: counts.get("APPLIED") ?? 0,
        sanctioned: counts.get("SANCTIONED") ?? 0,
        disbursed: counts.get("DISBURSED") ?? 0,
        closed: counts.get("CLOSED") ?? 0,
        totalOutstandingPaise: outstanding[0]?.total ?? 0,
      }),
    );
  },
);

router.get(
  "/operations/sales/leads",
  requireAuth,
  requireRole("ADMIN", "SALES"),
  async (req, res) => {
    const query = validate(ListSalesLeadsQueryParams, req.query);
    const appliedBorrowers = await Loan.distinct("borrowerId");
    const filter: Record<string, unknown> = {
      role: "BORROWER",
      _id: { $nin: appliedBorrowers },
    };
    if (query.search) {
      const pattern = escapedRegex(query.search.trim());
      filter.$or = [{ name: pattern }, { email: pattern }];
    }
    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .exec(),
      User.countDocuments(filter),
    ]);
    const payload = {
      items: users.map(leadDto),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
    const parsed = ListSalesLeadsResponse.safeParse(payload);
    if (!parsed.success) {
      throw new HttpError(
        500,
        "Sales leads response failed validation.",
        "RESPONSE_VALIDATION_ERROR",
        parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      );
    }
    res.json(parsed.data);
  },
);

router.post(
  "/operations/sales/leads/:id/notes",
  requireAuth,
  requireRole("ADMIN", "SALES"),
  async (req, res) => {
    const { id } = validate(AddSalesLeadNoteParams, req.params);
    const input = validate(AddSalesLeadNoteBody, req.body);
    const applied = await Loan.exists({ borrowerId: id });
    if (applied) {
      throw new HttpError(
        409,
        "This borrower has already applied and is no longer a sales lead.",
        "INVALID_STATE",
      );
    }
    const now = new Date();
    const noteEntry = {
      note: input.note.trim(),
      by: req.currentUser!.id,
      name: req.currentUser!.name,
      at: now,
    };
    const user = await User.findOneAndUpdate(
      { _id: id, role: "BORROWER" },
      {
        $set: {
          salesContact: {
            by: req.currentUser!.id,
            name: req.currentUser!.name,
            at: now,
          },
        },
        $push: {
          salesNotes: {
            $each: [noteEntry],
            $position: 0,
            $slice: 50,
          },
        },
      },
      { new: true, runValidators: true },
    ).exec();
    if (!user) {
      throw new HttpError(404, "Sales lead not found.", "NOT_FOUND");
    }
    res.json(AddSalesLeadNoteResponse.parse(leadDto(user)));
  },
);

router.get(
  "/operations/sanction/loans",
  requireAuth,
  requireRole("ADMIN", "SANCTION"),
  async (req, res) => {
    const query = validate(ListSanctionLoansQueryParams, req.query);
    res.json(ListSanctionLoansResponse.parse(await listLoans("APPLIED", query)));
  },
);

router.post(
  "/operations/sanction/loans/:id/approve",
  requireAuth,
  requireRole("ADMIN", "SANCTION"),
  async (req, res) => {
    const { id } = validate(ApproveLoanParams, req.params);
    const input = validate(ApproveLoanBody, req.body ?? {});
    const loan = await Loan.findOneAndUpdate(
      { _id: id, status: "APPLIED" },
      {
        $set: {
          status: "SANCTIONED",
          sanction: {
            by: req.currentUser!.id,
            name: req.currentUser!.name,
            at: new Date(),
            ...(input.note ? { note: input.note.trim() } : {}),
          },
        },
      },
      { new: true, runValidators: true },
    ).exec();
    if (!loan) {
      await throwTransitionError(id, "Loan");
      return;
    }
    res.json(ApproveLoanResponse.parse(loanDto(loan)));
  },
);

router.post(
  "/operations/sanction/loans/:id/reject",
  requireAuth,
  requireRole("ADMIN", "SANCTION"),
  async (req, res) => {
    const { id } = validate(RejectLoanParams, req.params);
    const input = validate(RejectLoanBody, req.body);
    const loan = await Loan.findOneAndUpdate(
      { _id: id, status: "APPLIED" },
      {
        $set: {
          status: "REJECTED",
          rejectionReason: input.reason.trim(),
        },
        $unset: { activeBorrower: 1 },
      },
      { new: true, runValidators: true },
    ).exec();
    if (!loan) {
      await throwTransitionError(id, "Loan");
      return;
    }
    res.json(RejectLoanResponse.parse(loanDto(loan)));
  },
);

router.get(
  "/operations/sanction/loans/:id/salary-slip",
  requireAuth,
  requireRole("ADMIN", "SANCTION"),
  async (req, res) => {
    const { id } = validate(DownloadSanctionSalarySlipParams, req.params);
    const loan = await Loan.findOne({ _id: id, status: "APPLIED" }).exec();
    if (!loan) throw new HttpError(404, "Loan or salary slip not found.", "NOT_FOUND");
    const salarySlip = await SalarySlip.findOne({
      _id: loan.salarySlipId,
      borrowerId: loan.borrowerId,
    })
      .select("+objectKey")
      .exec();
    if (!salarySlip) throw new HttpError(404, "Salary slip not found.", "NOT_FOUND");
    await streamPrivateObject(
      salarySlip.objectKey,
      salarySlip.contentType,
      salarySlip.fileName,
      res,
    );
  },
);

router.get(
  "/operations/disbursement/loans",
  requireAuth,
  requireRole("ADMIN", "DISBURSEMENT"),
  async (req, res) => {
    const query = validate(ListDisbursementLoansQueryParams, req.query);
    res.json(
      ListDisbursementLoansResponse.parse(await listLoans("SANCTIONED", query)),
    );
  },
);

router.post(
  "/operations/disbursement/loans/:id/disburse",
  requireAuth,
  requireRole("ADMIN", "DISBURSEMENT"),
  async (req, res) => {
    const { id } = validate(DisburseLoanParams, req.params);
    const input = validate(DisburseLoanBody, req.body ?? {});
    if (!input.confirmed) {
      throw new HttpError(400, "Confirm the disbursement before continuing.", "CONFIRMATION_REQUIRED");
    }
    const sanctionedLoan = await Loan.findOne({
      _id: id,
      status: "SANCTIONED",
    })
      .select("principalPaise")
      .exec();
    if (!sanctionedLoan) {
      await throwTransitionError(id, "Loan");
      return;
    }
    const loan = await Loan.findOneAndUpdate(
      { _id: id, status: "SANCTIONED" },
      {
        $set: {
          status: "DISBURSED",
          disbursement: {
            by: req.currentUser!.id,
            name: req.currentUser!.name,
            at: new Date(),
            amountPaise: sanctionedLoan.principalPaise,
          },
        },
      },
      { new: true, runValidators: true },
    ).exec();
    if (!loan) {
      await throwTransitionError(id, "Loan");
      return;
    }
    res.json(DisburseLoanResponse.parse(loanDto(loan)));
  },
);

router.get(
  "/operations/collection/loans",
  requireAuth,
  requireRole("ADMIN", "COLLECTION"),
  async (req, res) => {
    const query = validate(ListCollectionLoansQueryParams, req.query);
    const filter = {
      status: { $in: ["DISBURSED", "CLOSED"] as const },
      ...loanSearch(query.search),
    };
    const [items, total] = await Promise.all([
      Loan.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .exec(),
      Loan.countDocuments(filter),
    ]);
    res.json(
      ListCollectionLoansResponse.parse({
        items: items.map(loanDto),
        page: query.page,
        pageSize: query.pageSize,
        total,
      }),
    );
  },
);

router.get(
  "/operations/collection/loans/:id/payments",
  requireAuth,
  requireRole("ADMIN", "COLLECTION"),
  async (req, res) => {
    const { id } = validate(ListLoanPaymentsParams, req.params);
    const loan = await Loan.findById(id).exec();
    if (!loan) throw new HttpError(404, "Loan not found.", "NOT_FOUND");
    const payments = await Payment.find({ loanId: id })
      .sort({ paymentDate: -1, createdAt: -1 })
      .exec();
    res.json(
      ListLoanPaymentsResponse.parse({ items: payments.map(paymentDto) }),
    );
  },
);

router.post(
  "/operations/collection/loans/:id/payments",
  requireAuth,
  requireRole("ADMIN", "COLLECTION"),
  async (req, res) => {
    const { id } = validate(RecordLoanPaymentParams, req.params);
    const input = validate(RecordLoanPaymentBody, req.body);
    const normalizedUtr = validateUtr(input.utr);
    const paymentDate =
      input.paymentDate instanceof Date
        ? input.paymentDate
        : new Date(input.paymentDate);
    const session = await mongoose.startSession();
    let response:
      | {
          payment: ReturnType<typeof paymentDto>;
          loan: ReturnType<typeof loanDto>;
        }
      | undefined;

    try {
      await session.withTransaction(async () => {
        const loan = await Loan.findOne({ _id: id, status: "DISBURSED" })
          .session(session)
          .exec();
        if (!loan) {
          const exists = await Loan.exists({ _id: id }).session(session);
          if (!exists) throw new HttpError(404, "Loan not found.", "NOT_FOUND");
          throw new HttpError(
            409,
            "Payments can only be recorded for an open, disbursed loan.",
            "INVALID_STATE",
          );
        }

        try {
          validatePayment(
            input.amountPaise,
            loan.outstandingBalancePaise,
            paymentDate,
          );
        } catch (error) {
          throw new HttpError(
            400,
            error instanceof Error ? error.message : "Payment details are invalid.",
            "INVALID_PAYMENT",
          );
        }
        if (
          loan.disbursement?.at &&
          paymentDate.getTime() < loan.disbursement.at.getTime()
        ) {
          throw new HttpError(
            400,
            "Payment date cannot be before the disbursement date.",
            "INVALID_PAYMENT_DATE",
          );
        }

        const [payment] = await Payment.create(
          [
            {
              loanId: loan._id,
              borrowerId: loan.borrowerId,
              utr: normalizedUtr,
              normalizedUtr,
              amountPaise: input.amountPaise,
              paymentDate,
              recordedBy: req.currentUser!.id,
              recordedByName: req.currentUser!.name,
            },
          ],
          { session },
        );
        loan.totalPaidPaise += input.amountPaise;
        loan.outstandingBalancePaise -= input.amountPaise;
        if (loan.outstandingBalancePaise === 0) {
          loan.status = "CLOSED";
          loan.set("activeBorrower", undefined);
        }
        await loan.save({ session });
        response = {
          payment: paymentDto(payment),
          loan: loanDto(loan),
        };
      });
    } catch (error) {
      if (isDuplicateUtrError(error)) {
        throw new HttpError(409, "This UTR has already been recorded.", "DUPLICATE_UTR");
      }
      if (isTransactionUnavailable(error)) {
        throw new HttpError(
          503,
          "MongoDB transactions are required to record payments safely.",
          "TRANSACTIONS_UNAVAILABLE",
        );
      }
      throw error;
    } finally {
      await session.endSession();
    }

    if (!response) {
      throw new HttpError(500, "Payment was not recorded.", "PAYMENT_FAILED");
    }
    res.status(201).json(RecordLoanPaymentResponse.parse(response));
  },
);

function isDuplicateUtrError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === 11000,
  );
}

function isTransactionUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === 20 ||
    candidate.code === 251 ||
    (typeof candidate.message === "string" &&
      /transaction numbers are only allowed|replica set/i.test(candidate.message))
  );
}

export default router;
