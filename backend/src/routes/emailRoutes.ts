import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { schedule, scheduled, search, senders, sent } from "../controllers/emailController.js";

const router = Router();
router.use(requireAuth);
router.post("/schedule", schedule);
router.get("/senders", senders);
router.get("/scheduled", scheduled);
router.get("/sent", sent);
router.get("/search", search);
export default router;
