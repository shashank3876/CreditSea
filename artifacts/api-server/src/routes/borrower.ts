import { randomBytes } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import {
  ApplyForLoanBody,
  ApplyForLoanResponse,
  CheckBorrowerEligibilityBody,
  CheckBorrowerEligibilityResponse,
  DownloadBorrowerSalarySlipParams,
  GetBorrowerLoanParams,
  GetBorrowerLoanResponse,
  GetBorrowerProfileResponse,
  ListBorrowerLoanPaymentsParams,
  ListBorrowerLoanPaymentsResponse,
  ListBorrowerLoansResponse,
  UpdateBorrowerProfileBody,
  UpdateBorrowerProfileResponse,
  UploadSalarySlipResponse,
} from "@workspace/api-zod";
import {
  expectedSalarySlipContentType,
  MAX_SALARY_SLIP_BYTES,
  validateSalarySlipFile,
} from "../lib/uploadValidation";
import { checkEligibility, calculateLoanAmounts } from "../lib/domain";
import { HttpError } from "../lib/errors";
import { loanDto, maskPan, paymentDto, profileDto, salarySlipDto } from "../lib/dto";
import { Loan, Payment, SalarySlip, User } from "../lib/models";
import {
  createSalarySlipObjectKey,
  deletePrivateObject,
  savePrivateObject,
  streamPrivateObject,
} from "../lib/privateStorage";
import { encryptPan, requireAuth, requireRole } from "../lib/security";
import { validate } from "../lib/validation";

const router = Router();

const salarySlipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SALARY_SLIP_BYTES, files: 1, fields: 0 },
  fileFilter(_req, file, callback) {
    const expectedType = expectedSalarySlipContentType(file.originalname);
    if (!expectedType || file.mimetype !== expectedType) {
      callback(
        new HttpError(
          400,
          "Upload a PDF, JPG, JPEG, or PNG salary slip.",
          "INVALID_FILE",
        ),
      );
      return;
    }
    callback(null, true);
  },
});

async function getProfileForUser(userId: string) {
  const user = await User.findById(userId).select("+panEncrypted").exec();
  if (!user) throw new HttpError(404, "Borrower account not found.", "NOT_FOUND");
  const salarySlip = user.salarySlipId
    ? await SalarySlip.findById(user.salarySlipId).exec()
    : null;
  return { user, salarySlip, profile: profileDto(user, salarySlip) };
}

async function saveAndCheckEligibility(userId: string, rawInput: unknown) {
  const input = validate(UpdateBorrowerProfileBody, rawInput);
  const pan = input.pan.trim().toUpperCase();
  const dateOfBirth =
    input.dateOfBirth instanceof Date
      ? input.dateOfBirth
      : new Date(input.dateOfBirth);
  if (Number.isNaN(dateOfBirth.getTime())) {
    throw new HttpError(400, "Enter a valid date of birth.", "VALIDATION_ERROR");
  }
  const result = checkEligibility(
    {
      dateOfBirth: dateOfBirth.toISOString().slice(0, 10),
      monthlySalaryRupees: input.monthlySalaryRupees,
      employmentMode: input.employmentMode,
      pan,
    },
    new Date(),
  );

  const user = await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        name: input.name.trim(),
        panEncrypted: encryptPan(pan),
        panLast4: pan.slice(-4),
        dateOfBirth,
        monthlySalaryRupees: input.monthlySalaryRupees,
        employmentMode: input.employmentMode,
        eligibilityStatus: result.eligible ? "ELIGIBLE" : "INELIGIBLE",
        eligibilityErrors: result.errors,
      },
    },
    { new: true, runValidators: true },
  )
    .select("+panEncrypted")
    .exec();
  if (!user) throw new HttpError(404, "Borrower account not found.", "NOT_FOUND");

  const salarySlip = user.salarySlipId
    ? await SalarySlip.findById(user.salarySlipId).exec()
    : null;
  return {
    eligible: result.eligible,
    errors: result.errors,
    profile: profileDto(user, salarySlip),
  };
}

router.get(
  "/borrower/profile",
  requireAuth,
  requireRole("BORROWER"),
  async (req, res) => {
    const { profile } = await getProfileForUser(req.currentUser!.id);
    res.json(GetBorrowerProfileResponse.parse(profile));
  },
);

router.put(
  "/borrower/profile",
  requireAuth,
  requireRole("BORROWER"),
  async (req, res) => {
    const result = await saveAndCheckEligibility(req.currentUser!.id, req.body);
    res.json(UpdateBorrowerProfileResponse.parse(result));
  },
);

router.post(
  "/borrower/eligibility",
  requireAuth,
  requireRole("BORROWER"),
  async (req, res) => {
    const input = validate(CheckBorrowerEligibilityBody, req.body);
    const result = await saveAndCheckEligibility(req.currentUser!.id, input);
    res.json(CheckBorrowerEligibilityResponse.parse(result));
  },
);

router.post(
  "/borrower/salary-slip",
  requireAuth,
  requireRole("BORROWER"),
  salarySlipUpload.single("file"),
  async (req, res) => {
    const file = req.file;
    if (!file) {
      throw new HttpError(400, "Choose a salary-slip file to upload.", "INVALID_FILE");
    }
    let validatedFile: ReturnType<typeof validateSalarySlipFile>;
    try {
      validatedFile = validateSalarySlipFile({
        originalName: file.originalname,
        contentType: file.mimetype,
        sizeBytes: file.size,
        contents: file.buffer,
      });
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : "The salary-slip file is invalid.",
        "INVALID_FILE",
      );
    }

    const objectKey = createSalarySlipObjectKey();
    const borrowerId = req.currentUser!.id;
    await savePrivateObject(objectKey, file.buffer, validatedFile.contentType);
    try {
      const slip = await SalarySlip.create({
        borrowerId,
        objectKey,
        fileName: validatedFile.fileName,
        contentType: validatedFile.contentType,
        sizeBytes: file.size,
        uploadedAt: new Date(),
      });
      const user = await User.findByIdAndUpdate(
        borrowerId,
        { $set: { salarySlipId: slip._id } },
        { new: true },
      );
      if (!user) throw new HttpError(404, "Borrower account not found.", "NOT_FOUND");
      res.status(201).json(UploadSalarySlipResponse.parse(salarySlipDto(slip)));
    } catch (error) {
      await deletePrivateObject(objectKey).catch(() => undefined);
      throw error;
    }
  },
);

router.post(
  "/borrower/loans",
  requireAuth,
  requireRole("BORROWER"),
  async (req, res) => {
    const input = validate(ApplyForLoanBody, req.body);
    const borrowerId = req.currentUser!.id;
    const existing = await Loan.findOne({
      borrowerId,
      idempotencyKey: input.idempotencyKey,
    }).exec();
    if (existing) {
      res.status(201).json(ApplyForLoanResponse.parse(loanDto(existing)));
      return;
    }

    const user = await User.findById(borrowerId)
      .select("+panEncrypted +panLast4")
      .exec();
    if (
      !user ||
      user.eligibilityStatus !== "ELIGIBLE" ||
      !user.salarySlipId ||
      !user.panEncrypted ||
      !user.monthlySalaryRupees ||
      !user.employmentMode
    ) {
      throw new HttpError(
        400,
        "Complete the eligibility check and upload a salary slip before applying.",
        "BORROWER_NOT_READY",
      );
    }

    const activeLoan = await Loan.exists({ activeBorrower: borrowerId });
    if (activeLoan) {
      throw new HttpError(
        409,
        "You already have an active loan application.",
        "ACTIVE_LOAN_EXISTS",
      );
    }

    const slip = await SalarySlip.findOne({
      _id: user.salarySlipId,
      borrowerId,
    }).exec();
    if (!slip) {
      throw new HttpError(400, "Upload a valid salary slip before applying.", "SALARY_SLIP_REQUIRED");
    }

    const amounts = calculateLoanAmounts(
      input.loanAmountRupees,
      input.tenureDays,
    );
    try {
      const loan = await Loan.create({
        reference: `CS-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`,
        borrowerId,
        borrowerName: user.name,
        borrowerEmail: user.email,
        panMasked: user.panLast4
          ? `••••••${user.panLast4}`
          : maskPan(""),
        monthlySalaryRupees: user.monthlySalaryRupees,
        employmentMode: user.employmentMode,
        salarySlipId: slip._id,
        ...amounts,
        tenureDays: input.tenureDays,
        interestRatePercent: 12,
        totalPaidPaise: 0,
        outstandingBalancePaise: amounts.totalRepaymentPaise,
        status: "APPLIED",
        idempotencyKey: input.idempotencyKey,
        activeBorrower: user._id,
      });
      res.status(201).json(ApplyForLoanResponse.parse(loanDto(loan)));
    } catch (error) {
      if (isDuplicateKey(error)) {
        const replay = await Loan.findOne({
          borrowerId,
          idempotencyKey: input.idempotencyKey,
        }).exec();
        if (replay) {
          res.status(201).json(ApplyForLoanResponse.parse(loanDto(replay)));
          return;
        }
        throw new HttpError(
          409,
          "You already have an active loan application.",
          "ACTIVE_LOAN_EXISTS",
        );
      }
      throw error;
    }
  },
);

function isDuplicateKey(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === 11000,
  );
}

router.get(
  "/borrower/loans",
  requireAuth,
  requireRole("BORROWER"),
  async (req, res) => {
    const loans = await Loan.find({ borrowerId: req.currentUser!.id })
      .sort({ createdAt: -1 })
      .limit(100)
      .exec();
    res.json(
      ListBorrowerLoansResponse.parse({
        items: loans.map(loanDto),
        page: 1,
        pageSize: loans.length,
        total: loans.length,
      }),
    );
  },
);

router.get(
  "/borrower/loans/:id",
  requireAuth,
  requireRole("BORROWER"),
  async (req, res) => {
    const { id } = validate(GetBorrowerLoanParams, req.params);
    const loan = await Loan.findOne({
      _id: id,
      borrowerId: req.currentUser!.id,
    }).exec();
    if (!loan) throw new HttpError(404, "Loan not found.", "NOT_FOUND");
    res.json(GetBorrowerLoanResponse.parse(loanDto(loan)));
  },
);

router.get(
  "/borrower/loans/:id/salary-slip",
  requireAuth,
  requireRole("BORROWER"),
  async (req, res) => {
    const { id } = validate(DownloadBorrowerSalarySlipParams, req.params);
    const loan = await Loan.findOne({
      _id: id,
      borrowerId: req.currentUser!.id,
    }).exec();
    if (!loan) throw new HttpError(404, "Loan or salary slip not found.", "NOT_FOUND");
    const salarySlip = await SalarySlip.findOne({
      _id: loan.salarySlipId,
      borrowerId: req.currentUser!.id,
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
  "/borrower/loans/:id/payments",
  requireAuth,
  requireRole("BORROWER"),
  async (req, res) => {
    const { id } = validate(ListBorrowerLoanPaymentsParams, req.params);
    const loan = await Loan.findOne({
      _id: id,
      borrowerId: req.currentUser!.id,
    }).exec();
    if (!loan) throw new HttpError(404, "Loan not found.", "NOT_FOUND");
    const payments = await Payment.find({
      loanId: id,
      borrowerId: req.currentUser!.id,
    })
      .sort({ paymentDate: -1, createdAt: -1 })
      .exec();
    res.json(
      ListBorrowerLoanPaymentsResponse.parse({
        items: payments.map(paymentDto),
      }),
    );
  },
);

export default router;

