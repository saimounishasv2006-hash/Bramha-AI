// src/services/deploy.service.js
import { http } from "../config/axios.js";
import { getGithubRepoId } from "./github.service.js";

const VERCEL_API = "https://api.vercel.com";

const vzHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/json",
});

// Make a Vercel-safe project name
const sanitizeProjectName = (raw) => {
  let name = (raw || "app").toLowerCase();
  name = name.replace(/[^a-z0-9._-]/g, "-"); // keep only allowed chars
  name = name.replace(/-+/g, "-"); // collapse multi dashes
  while (name.includes("---")) name = name.replace(/---/g, "--"); // avoid triple
  if (name.length > 100) name = name.slice(0, 100);
  if (!name) name = "app";
  return name;
};

// Build minimal projectSettings for new projects
const buildProjectSettings = (frameworkHint) => {
  const ps = {
    framework: null,
    devCommand: null,
    installCommand: null,
    buildCommand: null,
    outputDirectory: null,
    rootDirectory: null,
  };
  switch ((frameworkHint || "").toLowerCase()) {
    case "vite":
      ps.buildCommand = "npm run build";
      ps.outputDirectory = "dist";
      break;
    case "next":
      ps.buildCommand = "npm run build";
      break;
    case "static":
      ps.outputDirectory = ".";
      break;
    default:
      break;
  }
  return ps;
};

/**
 * Trigger a Vercel deployment tied to a GitHub repo.
 */
export const triggerVercelDeploy = async ({
  ownerRepo,
  branch = "main",
  githubToken,
  token,
  teamId,
  projectName,
  frameworkHint,
  projectSettings,
}) => {
  const vercelToken = token || process.env.VERCEL_TOKEN;
  if (!vercelToken)
    return {
      deploymentId: null,
      url: null,
      skipped: true,
      reason: "missing_token",
    };

  // 1) GitHub repo id
  const repoId = await getGithubRepoId(ownerRepo, githubToken);

  // 2) Safe project name
  const repoOnly = ownerRepo.split("/")[1] || ownerRepo;
  const prefix = process.env.VERCEL_PROJECT_NAME_PREFIX || "autoapp";
  const desired = projectName || `${prefix}-${repoOnly}`;
  const safeName = sanitizeProjectName(desired);

  // 3) Query params
  const params = new URLSearchParams();
  const _teamId = teamId || process.env.VERCEL_TEAM_ID;
  if (_teamId) params.set("teamId", _teamId);
  params.set("skipAutoDetectionConfirmation", "1");

  // 4) projectSettings
  const ps = projectSettings || buildProjectSettings(frameworkHint);

  // 5) Create deployment
  const payload = {
    name: safeName,
    gitSource: { type: "github", repoId, ref: branch },
    projectSettings: ps,
  };

  const { data } = await http.post(
    `${VERCEL_API}/v13/deployments?${params.toString()}`,
    payload,
    { headers: vzHeaders(vercelToken) }
  );

  return { deploymentId: data.id, url: data.url, projectName: safeName };
};

// Exported helper used by idea.controller fallback
export async function isDeploymentReachable(hostname) {
  if (!hostname) return false;
  try {
    const { status } = await http.get(`https://${hostname}`, {
      timeout: 7000,
      maxRedirects: 0,
      validateStatus: (s) => s < 500,
    });
    return status < 500;
  } catch {
    return false;
  }
}

export const waitForVercel = async (
  deploymentId,
  { token, teamId, attempts = 30, intervalMs = 3000 } = {}
) => {
  const vercelToken = token || process.env.VERCEL_TOKEN;
  if (!vercelToken || !deploymentId) return null;

  const params = new URLSearchParams();
  const _teamId = teamId || process.env.VERCEL_TEAM_ID;
  if (_teamId) params.set("teamId", _teamId);

  for (let i = 0; i < attempts; i++) {
    const { data } = await http.get(
      `${VERCEL_API}/v13/deployments/${deploymentId}?${params.toString()}`,
      { headers: vzHeaders(vercelToken) }
    );

    const st = (data.state || data.readyState || "").toUpperCase();
    if (st === "READY" || st === "SUCCEEDED")
      return { state: "READY", url: data.url };
    if (st === "ERROR" || st === "CANCELED") {
      return {
        state: st,
        url: data.url,
        error: data?.error?.message || "Deployment failed",
      };
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { state: "TIMEOUT" };
};
