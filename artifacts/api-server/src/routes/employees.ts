import { Router } from "express";
import bcrypt from "bcryptjs";
import {
  CreateEmployeeBody,
  CreateEmployeeResponse,
  ListEmployeesQueryParams,
  ListEmployeesResponse,
  UpdateEmployeeStatusBody,
  UpdateEmployeeStatusParams,
  UpdateEmployeeStatusResponse,
} from "@workspace/api-zod";
import { isAssignableEmployeeRole } from "../lib/domain";
import { employeeDto } from "../lib/dto";
import { HttpError } from "../lib/errors";
import { User } from "../lib/models";
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

router.get(
  "/operations/employees",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const query = validate(ListEmployeesQueryParams, req.query);
    const filter: Record<string, unknown> = {
      role: { $in: STAFF_ROLES },
    };
    if (query.search?.trim()) {
      const pattern = escapedRegex(query.search.trim());
      filter.$or = [{ name: pattern }, { email: pattern }];
    }

    const [items, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .exec(),
      User.countDocuments(filter),
    ]);

    res.json(
      ListEmployeesResponse.parse({
        items: items.map(employeeDto),
        page: query.page,
        pageSize: query.pageSize,
        total,
      }),
    );
  },
);

router.post(
  "/operations/employees",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const input = validate(CreateEmployeeBody, req.body);
    if (!isAssignableEmployeeRole(input.role)) {
      throw new HttpError(
        400,
        "Employees can only be assigned Sales, Sanction, Disbursement, or Collection roles.",
        "VALIDATION_ERROR",
      );
    }

    const email = input.email.trim().toLowerCase();
    if (await User.exists({ email })) {
      throw new HttpError(
        409,
        "An account with this email already exists.",
        "CONFLICT",
      );
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await User.create({
      name: input.name.trim(),
      email,
      passwordHash,
      role: input.role,
      status: "ACTIVE",
      eligibilityStatus: "NOT_CHECKED",
      eligibilityErrors: [],
    });

    res.status(201).json(CreateEmployeeResponse.parse(employeeDto(user)));
  },
);

router.patch(
  "/operations/employees/:id/status",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const params = validate(UpdateEmployeeStatusParams, req.params);
    const input = validate(UpdateEmployeeStatusBody, req.body);

    if (params.id === req.currentUser!.id) {
      throw new HttpError(
        400,
        "You cannot change the status of your own account.",
        "VALIDATION_ERROR",
      );
    }

    const user = await User.findById(params.id).exec();
    if (!user || user.role === "BORROWER") {
      throw new HttpError(404, "Employee account not found.", "NOT_FOUND");
    }
    if (user.role === "ADMIN") {
      throw new HttpError(
        400,
        "Admin account status cannot be changed from employee management.",
        "VALIDATION_ERROR",
      );
    }
    if (!isAssignableEmployeeRole(user.role)) {
      throw new HttpError(404, "Employee account not found.", "NOT_FOUND");
    }

    user.status = input.status;
    await user.save();
    res.json(UpdateEmployeeStatusResponse.parse(employeeDto(user)));
  },
);

export default router;
