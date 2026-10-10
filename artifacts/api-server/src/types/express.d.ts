import type { UserRole } from "../lib/models";

declare global {
  namespace Express {
    interface Request {
      currentUser?: {
        id: string;
        name: string;
        email: string;
        role: UserRole;
        createdAt: Date;
      };
    }
  }
}

export {};
