// src/server.js
import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
dotenv.config();

import auth from "./routes/auth.routes.js";
import idea from "./routes/idea.routes.js";
import feedback from "./routes/feedback.routes.js";
import status from "./routes/status.routes.js";
import deploy from "./routes/deploy.routes.js";
import { requireAuth } from "./middleware/auth.js";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use(
  cors({
    origin: (process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    credentials: true,
  })
);
app.use(morgan("dev"));

app.get("/", (_req, res) =>
  res.json({ ok: true, service: "auto-dev-backend" })
);

// auth
app.use("/auth", auth);

// protected APIs
app.use("/idea", requireAuth, idea);
app.use("/feedback", requireAuth, feedback);
app.use("/deploy", requireAuth, deploy);

// public status
app.use("/status", status);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`API on :${PORT}`));
