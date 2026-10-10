import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import borrowerRouter from "./borrower";
import operationsRouter from "./operations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(borrowerRouter);
router.use(operationsRouter);

export default router;
