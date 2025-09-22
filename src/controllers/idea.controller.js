// src/controllers/idea.controller.js
import { v4 as uuid } from "uuid";
import {
  createJob,
  setStatus,
  step,
  setData,
} from "../services/status.service.js";
import { generateProjectFromIdea } from "../services/llm.service.js";
import {
  getAuthedUser,
  createRepoIfMissing,
  pushFilesToRepo,
} from "../services/repo.service.js";
import {
  triggerVercelDeploy,
  waitForVercel,
  isDeploymentReachable,
} from "../services/deploy.service.js";
import { makeZipBuffer } from "../services/zip.service.js";
import { uploadZipToIPFS } from "../services/ipfs.service.js";
import { sanitizeForVercel } from "../services/project.sanitizer.js";
import { pickRepoNameForProject } from "../services/naming.service.js";

export const postIdea = async (req, res) => {
  const authed = req.user;
  if (!authed?.githubToken) {
    return res
      .status(401)
      .json({ error: "not authenticated (login with GitHub first)" });
  }

  const { idea } = req.body;
  if (!idea) return res.status(400).json({ error: "idea is required" });

  const engine = (req.body.engine || "frontend").toLowerCase();

  const projectKey = req.body.project || req.body.projectName || null;

  const jobId = uuid();
  createJob(jobId);
  setStatus(jobId, "running");
  step(jobId, "received_idea", { idea, projectKey, engine });

  try {
    const ghUser = await getAuthedUser(authed.githubToken);
    const ownerLogin = ghUser.login;

    const repoName = pickRepoNameForProject({ projectKey, jobId });
    step(jobId, "repo_name_selected", { projectKey, repoName });

    const gen = await generateProjectFromIdea(idea, {
      engine,
      projectName: repoName,
    });
    step(jobId, "engine_completed", {
      engine,
      fileCount: gen?.files?.length || 0,
      frameworkHint: gen?.frameworkHint || null,
      canDeployToVercel: !!gen?.canDeployToVercel,
    });

    let finalFiles = Array.isArray(gen?.files) ? gen.files : [];
    let framework = gen?.frameworkHint || null;
    let changes = [];

    if (gen?.canDeployToVercel) {
      const sanitized = sanitizeForVercel(finalFiles);
      finalFiles = sanitized.files;
      framework = sanitized.framework || framework;
      changes = sanitized.changes || [];
      step(jobId, "sanitized_for_vercel", { framework, changes });
    } else {
      step(jobId, "sanitized_for_vercel", {
        framework: null,
        changes: ["no_deploy_backend_or_web3"],
      });
    }

    step(jobId, "code_generated", { fileCount: finalFiles.length });

    await createRepoIfMissing({
      token: authed.githubToken,
      ownerLogin,
      repoName,
    });

    await pushFilesToRepo({
      token: authed.githubToken,
      ownerLogin,
      repoName,
      files: finalFiles,
    });

    step(jobId, "github_pushed", { ownerLogin, repoName });

    let liveUrl = null;
    if (gen?.canDeployToVercel) {
      const ownerRepo = `${ownerLogin}/${repoName}`;

      const dep = await triggerVercelDeploy({
        ownerRepo,
        branch: "main",
        githubToken: authed.githubToken,
        projectName: repoName,
        frameworkHint: framework,
        projectSettings: gen?.projectSettings || undefined,
      });

      if (dep?.deploymentId || dep?.url) {
        step(jobId, "vercel_triggered", dep);
      }

      if (dep?.deploymentId) {
        const v = await waitForVercel(dep.deploymentId, {});
        step(jobId, "vercel_status", v);

        if (v?.state === "READY" && v?.url) {
          liveUrl = `https://${v.url}`;
        } else if (dep?.url && (await isDeploymentReachable(dep.url))) {
          liveUrl = `https://${dep.url}`;
        }
      }
    }

    const zipBuffer = makeZipBuffer(finalFiles);
    const cid = await uploadZipToIPFS(zipBuffer);
    if (cid) step(jobId, "ipfs_uploaded", { cid });

    const payload = {
      repo: `https://github.com/${ownerLogin}/${repoName}`,
      deployUrl: liveUrl,
      ipfsCid: cid || null,
    };
    setData(jobId, payload);
    setStatus(jobId, "completed");

    return res.json({ jobId, ...payload });
  } catch (e) {
    setStatus(jobId, "failed");
    step(jobId, "error", { message: e?.response?.data || e.message });
    return res
      .status(500)
      .json({ jobId, error: e?.response?.data || e.message });
  }
};
