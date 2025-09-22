import { Router } from "express";
import {
  githubLogin,
  githubCallback,
  me,
  logout,
} from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.js";

const r = Router();
r.get("/github/login", githubLogin);
r.get("/github/callback", githubCallback);
r.get("/me", requireAuth, me);
r.post("/logout", requireAuth, logout);
export default r;
