import { Router } from "express";
import { postFeedback } from "../controllers/feedback.controller.js";
const r = Router();
r.post("/", postFeedback);
export default r;
