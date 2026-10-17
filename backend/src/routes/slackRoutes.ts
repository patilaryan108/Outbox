import { Router } from "express";
import { callback, connect, disconnect, status } from "../controllers/slackController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.get("/connect", requireAuth, connect);
router.get("/callback", callback);
router.get("/status", requireAuth, status);
router.delete("/disconnect", requireAuth, disconnect);
export default router;
