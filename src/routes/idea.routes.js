// src/routes/idea.routes.js
import { Router } from "express";
import { postIdea } from "../controllers/idea.controller.js";

const r = Router();
r.post("/", postIdea);
export default r;
