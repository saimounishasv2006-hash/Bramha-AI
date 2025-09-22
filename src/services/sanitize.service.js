// src/services/sanitize.service.js
export function sanitizeForVercel(files) {
  const out = [];
  const changes = [];
  let replacedNextConfig = false;

  for (const f of files) {
    // Drop TS config; we'll replace with mjs
    if (f.path === "next.config.ts") {
      replacedNextConfig = true;
      continue;
    }

    // If vercel.json has legacy "builds", strip them
    if (f.path === "vercel.json") {
      try {
        const json = JSON.parse(f.content);
        if (Array.isArray(json.builds)) {
          delete json.builds;
          changes.push("removed_legacy_vercel_builds");
          out.push({ path: f.path, content: JSON.stringify(json, null, 2) });
          continue;
        }
      } catch {
        // keep as is if it wasn't valid JSON
      }
    }

    out.push(f);
  }

  if (replacedNextConfig) {
    out.push({
      path: "next.config.mjs",
      content: `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { typedRoutes: false }
};
export default nextConfig;`,
    });
    changes.push("replaced_next_config_ts_with_mjs");
  }

  return { files: out, changes };
}
