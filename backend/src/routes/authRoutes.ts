import { Router } from "express";
import { currentUser, devLogin, googleCallback, googleLogin, logout } from "../controllers/authController.js";

const router = Router();
router.get("/google", googleLogin);
router.get("/google/callback", googleCallback);
router.get("/me", currentUser);
router.post("/logout", logout);
router.post("/dev", devLogin);
export default router;
