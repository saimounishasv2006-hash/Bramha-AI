// src/services/naming.service.js

// Keep only chars Vercel/GitHub like, collapse dashes, limit length.
const sanitize = (raw) => {
  let n = String(raw || "app").toLowerCase();
  n = n.replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-");
  if (n.length > 100) n = n.slice(0, 100);
  if (!n) n = "app";
  return n;
};

// Slug just for project keys coming from users' text
const slugify = (raw) =>
  String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);

/**
 * One-repo-per-project.
 * - If `projectKey` is provided, repo = <PREFIX>-<slug(projectKey)>
 * - Otherwise fall back to unique-by-job so first run still works.
 */
export function pickRepoNameForProject({ projectKey, jobId }) {
  const prefix = process.env.VERCEL_PROJECT_NAME_PREFIX || "autoapp";
  if (projectKey) return sanitize(`${prefix}-${slugify(projectKey)}`);
  return sanitize(`${prefix}-${(jobId || "").slice(0, 8)}`);
}
