import { Router } from "express";
import { getStatus } from "../controllers/status.controller.js";
const r = Router();
r.get("/:id", getStatus);
export default r;
