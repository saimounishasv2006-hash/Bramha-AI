// src/services/repo.service.js
import { http } from "../config/axios.js";

const GH_API = "https://api.github.com";

const ghHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

const norm = (p) => (p || "").replace(/^[./]+/, "");

// ---------- Basics ----------
export async function getAuthedUser(token) {
  const { data } = await http.get(`${GH_API}/user`, {
    headers: ghHeaders(token),
  });
  return data; // { login, id, ... }
}

export async function getRepo({ token, owner, repo }) {
  return http
    .get(`${GH_API}/repos/${owner}/${repo}`, { headers: ghHeaders(token) })
    .then((r) => r.data)
    .catch((e) => (e?.response?.status === 404 ? null : Promise.reject(e)));
}

export async function createRepoIfMissing({
  token,
  ownerLogin,
  repoName,
  privateRepo = true,
}) {
  const exists = await getRepo({ token, owner: ownerLogin, repo: repoName });
  if (exists) return exists;

  // create on the authenticated user
  const body = { name: repoName, private: !!privateRepo, auto_init: true };
  const { data } = await http.post(`${GH_API}/user/repos`, body, {
    headers: ghHeaders(token),
  });
  return data;
}

export async function getGithubRepoId(ownerRepo, token) {
  const [owner, repo] = ownerRepo.split("/");
  const data = await getRepo({ token, owner, repo });
  if (!data) throw new Error(`Repo not found: ${ownerRepo}`);
  return data.id;
}

// ---------- Low-level git plumbing ----------
async function getDefaultBranch({ token, owner, repo }) {
  const data = await getRepo({ token, owner, repo });
  return data?.default_branch || "main";
}

async function getHeadSha({ token, owner, repo, branch }) {
  // Try branch ref
  const url = `${GH_API}/repos/${owner}/${repo}/git/ref/heads/${branch}`;
  const res = await http
    .get(url, { headers: ghHeaders(token) })
    .catch(() => null);
  return res?.data?.object?.sha || null;
}

async function createBlob({ token, owner, repo, content }) {
  const body = {
    content: Buffer.from(String(content), "utf8").toString("base64"),
    encoding: "base64",
  };
  const { data } = await http.post(
    `${GH_API}/repos/${owner}/${repo}/git/blobs`,
    body,
    { headers: ghHeaders(token) }
  );
  return data.sha;
}

async function createTree({ token, owner, repo, files }) {
  // Build entries (no base_tree → fresh tree replaces everything)
  const tree = [];
  for (const f of files) {
    const path = norm(f.path);
    if (!path || path.endsWith("/")) continue;
    const sha = await createBlob({
      token,
      owner,
      repo,
      content: f.content ?? "",
    });
    tree.push({ path, mode: "100644", type: "blob", sha });
  }
  const { data } = await http.post(
    `${GH_API}/repos/${owner}/${repo}/git/trees`,
    { tree }, // no base_tree => we define complete tree
    { headers: ghHeaders(token) }
  );
  return data.sha;
}

async function createCommit({
  token,
  owner,
  repo,
  message,
  treeSha,
  parentSha,
}) {
  const body = parentSha
    ? { message, tree: treeSha, parents: [parentSha] }
    : { message, tree: treeSha }; // empty repo fallback
  const { data } = await http.post(
    `${GH_API}/repos/${owner}/${repo}/git/commits`,
    body,
    { headers: ghHeaders(token) }
  );
  return data.sha;
}

async function updateRef({ token, owner, repo, branch, commitSha }) {
  // Force update to ensure the repo matches exactly our tree (deletes stale files)
  await http.patch(
    `${GH_API}/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    { sha: commitSha, force: true },
    { headers: ghHeaders(token) }
  );
}

// ---------- High-level push (HARD RESET) ----------
export async function pushFilesToRepo({
  token,
  ownerLogin,
  repoName,
  files,
  commitMessage,
}) {
  const owner = ownerLogin;
  const repo = repoName;

  // Ensure repo exists (auto_init so there is at least 1 commit)
  await createRepoIfMissing({ token, ownerLogin: owner, repoName: repo });

  const branch = await getDefaultBranch({ token, owner, repo });
  const headSha = await getHeadSha({ token, owner, repo, branch });

  // Fresh tree with ONLY the provided files
  const treeSha = await createTree({ token, owner, repo, files });
  const commitSha = await createCommit({
    token,
    owner,
    repo,
    message: commitMessage || "autoapp: replace repo with generated files",
    treeSha,
    parentSha: headSha,
  });
  await updateRef({ token, owner, repo, branch, commitSha });

  return { branch, commitSha };
}
