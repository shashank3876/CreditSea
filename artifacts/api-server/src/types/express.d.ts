import type { AccountStatus, UserRole } from "../lib/models";

declare global {
  namespace Express {
    interface Request {
      currentUser?: {
        id: string;
        name: string;
        email: string;
        role: UserRole;
        status: AccountStatus;
        createdAt: Date;
      };
    }
  }
}

export {};
