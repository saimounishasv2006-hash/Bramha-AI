// src/routes/deploy.routes.js
import { Router } from "express";
import { deployNow } from "../controllers/deploy.controller.js";

const r = Router();
r.post("/", deployNow);
export default r;
