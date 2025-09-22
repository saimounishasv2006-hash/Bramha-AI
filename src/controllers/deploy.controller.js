// src/controllers/deploy.controller.js
import { v4 as uuid } from "uuid";
import {
  createJob,
  setStatus,
  setData,
  step,
} from "../services/status.service.js";
import {
  triggerVercelDeploy,
  waitForVercel,
} from "../services/deploy.service.js";

const ownerRepoFromInput = (input) => {
  if (!input) return null;
  let s = input.trim();
  if (s.includes("github.com/")) s = s.split("github.com/")[1];
  s = s.replace(/\.git$/i, "");
  const [owner, repo] = s.split("/");
  return owner && repo ? `${owner}/${repo}` : null;
};

export const deployNow = async (req, res) => {
  const { repo, branch = "main", framework } = req.body;
  const ownerRepo = ownerRepoFromInput(repo);
  if (!ownerRepo)
    return res.status(400).json({ error: "invalid repo (owner/repo)" });
  if (!req.user?.githubToken)
    return res.status(401).json({ error: "login with GitHub first" });

  const jobId = uuid();
  createJob(jobId);
  setStatus(jobId, "running");
  step(jobId, "deploy_requested", {
    repo: ownerRepo,
    branch,
    framework: framework || null,
  });

  try {
    const [_, repoOnly] = ownerRepo.split("/");
    const dep = await triggerVercelDeploy({
      ownerRepo,
      branch,
      githubToken: req.user.githubToken,
      projectName: repoOnly,
      frameworkHint: framework,
    });
    step(jobId, "vercel_triggered", dep);

    if (!dep.deploymentId) {
      setStatus(jobId, "failed");
      return res.status(500).json({
        jobId,
        error:
          "Deploy not triggered (set VERCEL_TOKEN, and ensure the repo is connected/accessible in Vercel).",
      });
    }

    const result = await waitForVercel(dep.deploymentId, {});
    step(jobId, "vercel_status", result);

    if (result?.state === "READY" && result?.url) {
      const liveUrl = `https://${result.url}`;
      setData(jobId, { liveUrl });
      setStatus(jobId, "completed");
      return res.json({
        jobId,
        state: "READY",
        liveUrl,
        deploymentId: dep.deploymentId,
      });
    }

    setStatus(jobId, "failed");
    return res.status(502).json({
      jobId,
      state: result?.state || "UNKNOWN",
      error: result?.error || "Deployment did not become READY",
      deploymentId: dep.deploymentId,
    });
  } catch (e) {
    setStatus(jobId, "failed");
    step(jobId, "error", { message: e?.response?.data || e.message });
    return res
      .status(500)
      .json({ jobId, error: e?.response?.data || e.message });
  }
};
