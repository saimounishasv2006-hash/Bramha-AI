// src/services/project.sanitizer.js
// Vercel-ready normalizer for generated projects.
// - Fixes Next.js conflicts (App Router vs Pages Router)
// - Normalizes Windows "\" to "/" so removals work
// - Ensures Next config + TS types, removes ESLint configs
// - Still handles vite/static

const text = (s) => (typeof s === "string" ? s : String(s || ""));
// 🔧 KEY FIX: normalize backslashes -> forward slashes, then trim leading ./
// (This is what makes deletions of pages/* actually work on Windows-generated paths)
const norm = (p) =>
  String(p || "")
    .replace(/\\/g, "/")
    .replace(/^[./]+/, "");

const getFile = (files, path) => files.find((f) => norm(f.path) === norm(path));
const hasFile = (files, path) => !!getFile(files, path);

const upsertFile = (files, path, content) => {
  const p = norm(path);
  const i = files.findIndex((f) => norm(f.path) === p);
  if (i >= 0) files[i].content = content;
  else files.push({ path: p, content });
};

const removeFile = (files, path) => {
  const p = norm(path);
  const i = files.findIndex((f) => norm(f.path) === p);
  if (i >= 0) files.splice(i, 1);
};

const removeDirPrefix = (files, dir) => {
  const prefix = norm(dir).replace(/\/+$/, "") + "/";
  for (let i = files.length - 1; i >= 0; i--) {
    if (norm(files[i].path).startsWith(prefix)) files.splice(i, 1);
  }
};

const removeAny = (files, paths) => {
  const set = new Set(paths.map(norm));
  for (let i = files.length - 1; i >= 0; i--) {
    if (set.has(norm(files[i].path))) files.splice(i, 1);
  }
};

const readJSON = (content) => {
  try {
    return JSON.parse(text(content));
  } catch {
    return null;
  }
};
const writeJSON = (obj) => JSON.stringify(obj, null, 2) + "\n";

const hasTS = (files) => files.some((f) => /\.(ts|tsx)$/.test(norm(f.path)));
const hasAppRouter = (files) =>
  files.some((f) => norm(f.path).startsWith("app/"));
const hasPagesRouter = (files) =>
  files.some((f) => norm(f.path).startsWith("pages/"));

const stripLegacyVercelBuilds = (files) => {
  const vf = getFile(files, "vercel.json");
  if (!vf) return false;
  const j = readJSON(vf.content);
  if (!j || !j.builds) return false;
  delete j.builds;
  upsertFile(files, "vercel.json", writeJSON(j));
  return true;
};

const ensureTSConfig = (files) => {
  if (hasFile(files, "tsconfig.json")) return;
  upsertFile(
    files,
    "tsconfig.json",
    writeJSON({
      compilerOptions: {
        target: "ES2020",
        lib: ["DOM", "ES2020"],
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        jsx: "preserve",
        noEmit: true,
        resolveJsonModule: true,
        isolatedModules: true,
        allowJs: true,
        skipLibCheck: true,
        esModuleInterop: true,
        forceConsistentCasingInFileNames: true,
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
      exclude: ["node_modules"],
    })
  );
};

const ensureNextEnvDts = (files) => {
  if (!hasTS(files) || hasFile(files, "next-env.d.ts")) return;
  upsertFile(
    files,
    "next-env.d.ts",
    `/// <reference types="next" />
/// <reference types="next/image-types/global" />
// NOTE: This file should not be edited.
`
  );
};

const ensureNextConfigJS = (files) => {
  if (hasFile(files, "next.config.ts")) removeFile(files, "next.config.ts");
  upsertFile(
    files,
    "next.config.js",
    `/** Auto-generated */
/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true, eslint: { ignoreDuringBuilds: true } };
module.exports = nextConfig;
`
  );
};

const removeESLintConfigs = (files) => {
  removeAny(files, [
    ".eslintrc",
    ".eslintrc.json",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslint.js",
  ]);
};

const ensureTypesForNext = (files) => {
  const pkg = getFile(files, "package.json");
  const pkgJson = pkg ? readJSON(pkg.content) : {} || {};
  pkgJson.name = pkgJson.name || "app";
  pkgJson.private = pkgJson.private ?? true;
  pkgJson.scripts = {
    dev: pkgJson?.scripts?.dev || "next dev",
    build: pkgJson?.scripts?.build || "next build",
    start: pkgJson?.scripts?.start || "next start",
  };
  pkgJson.dependencies = pkgJson.dependencies || {};
  pkgJson.dependencies.next = pkgJson.dependencies.next || "^14";
  pkgJson.dependencies.react = pkgJson.dependencies.react || "^18";
  pkgJson.dependencies["react-dom"] =
    pkgJson.dependencies["react-dom"] || "^18";

  if (hasTS(files)) {
    pkgJson.devDependencies = pkgJson.devDependencies || {};
    pkgJson.devDependencies["@types/react"] =
      pkgJson.devDependencies["@types/react"] || "^18";
    pkgJson.devDependencies["@types/node"] =
      pkgJson.devDependencies["@types/node"] || "^20";
  }
  upsertFile(files, "package.json", writeJSON(pkgJson));
};

const ensureNextHomepage = (files) => {
  // 🔒 Prefer App Router when any app/* exists. If so, ALWAYS remove pages/*.
  const appMode = hasAppRouter(files);
  if (appMode) {
    removeDirPrefix(files, "pages"); // <- hard kill pages/*
    if (!hasFile(files, "app/layout.tsx")) {
      upsertFile(
        files,
        "app/layout.tsx",
        `export const metadata = { title: "App" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body className="min-h-screen">{children}</body></html>);
}
`
      );
    }
    if (!hasFile(files, "app/page.tsx") && !hasFile(files, "app/page.jsx")) {
      upsertFile(
        files,
        "app/page.tsx",
        `export default function Page() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-semibold">It works 🎉</h1>
      <p className="mt-2 text-gray-600">Deployed via autoapp. Edit <code>app/page.tsx</code>.</p>
    </main>
  );
}
`
      );
    }
  } else {
    // Pages Router path: ensure a pages/index.js and remove any app/*
    if (hasAppRouter(files)) removeDirPrefix(files, "app");
    if (!hasFile(files, "pages/index.js")) {
      upsertFile(
        files,
        "pages/index.js",
        `export default function Home(){
  return (
    <main style={{padding:24,fontFamily:"system-ui,Arial"}}>
      <h1>It works 🎉</h1>
      <p>Deployed via autoapp. Edit <code>pages/index.js</code>.</p>
    </main>
  );
}
`
      );
    }
  }

  ensureNextConfigJS(files);
  ensureTypesForNext(files);
  ensureTSConfig(files);
  ensureNextEnvDts(files);
  removeESLintConfigs(files);

  // 🔧 Safety net: if both app/* and pages/* still exist for ANY reason, drop pages/*
  if (hasAppRouter(files) && hasPagesRouter(files))
    removeDirPrefix(files, "pages");

  return "next";
};

const ensureViteHomepage = (files) => {
  if (!hasFile(files, "index.html")) {
    upsertFile(
      files,
      "index.html",
      `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>It works 🎉</title></head><body><div id="root"></div><script type="module">document.getElementById('root').innerHTML='Deployed via autoapp. Replace this with your app.'</script></body></html>
`
    );
  }
  const pkg = getFile(files, "package.json");
  const pkgJson = pkg ? readJSON(pkg.content) : {};
  pkgJson.scripts = pkgJson.scripts || {};
  pkgJson.scripts.dev = pkgJson.scripts.dev || "vite";
  pkgJson.scripts.build = pkgJson.scripts.build || "vite build";
  pkgJson.dependencies = pkgJson.dependencies || {};
  pkgJson.devDependencies = pkgJson.devDependencies || {};
  pkgJson.devDependencies.vite = pkgJson.devDependencies.vite || "^5";
  upsertFile(files, "package.json", writeJSON(pkgJson));

  const vercel = getFile(files, "vercel.json");
  if (vercel) {
    const j = readJSON(vercel.content) || {};
    delete j.builds;
    j.buildCommand = j.buildCommand || "npm run build";
    j.outputDirectory = j.outputDirectory || "dist";
    j.rewrites = j.rewrites || [{ source: "/(.*)", destination: "/" }];
    upsertFile(files, "vercel.json", writeJSON(j));
  } else {
    upsertFile(
      files,
      "vercel.json",
      writeJSON({
        buildCommand: "npm run build",
        outputDirectory: "dist",
        rewrites: [{ source: "/(.*)", destination: "/" }],
      })
    );
  }
  return "vite";
};

const ensureStaticHomepage = (files) => {
  if (!hasFile(files, "index.html")) {
    upsertFile(
      files,
      "index.html",
      `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>It works 🎉</title><style>body{font-family:system-ui,Arial;padding:24px}</style></head><body><h1>It works 🎉</h1><p>Deployed via autoapp. Replace this with your generated UI.</p></body></html>
`
    );
  }
  const vf = getFile(files, "vercel.json");
  if (vf) {
    const j = readJSON(vf.content) || {};
    if (j.builds) {
      delete j.builds;
      upsertFile(files, "vercel.json", writeJSON(j));
    }
  }
  return "static";
};

const detectFramework = (files) => {
  const pkg = getFile(files, "package.json");
  const pkgJson = pkg ? readJSON(pkg.content) : null;
  const deps = {
    ...(pkgJson?.dependencies || {}),
    ...(pkgJson?.devDependencies || {}),
  };

  if (
    deps["next"] ||
    hasAppRouter(files) ||
    hasPagesRouter(files) ||
    hasFile(files, "next.config.js") ||
    hasFile(files, "next.config.mjs")
  ) {
    return "next";
  }
  if (
    deps["vite"] ||
    hasFile(files, "vite.config.ts") ||
    hasFile(files, "vite.config.js")
  ) {
    return "vite";
  }
  if (hasFile(files, "index.html")) return "static";
  return "static";
};

// Public API
export function sanitizeForVercel(files) {
  const changes = [];
  if (stripLegacyVercelBuilds(files))
    changes.push("removed_legacy_vercel_builds");

  const fw = detectFramework(files);
  let finalType = fw;

  if (fw === "next") {
    finalType = ensureNextHomepage(files);
    changes.push("normalized_next:prefer_app_router_remove_conflicts");
    changes.push("ensured_next_config_js_ts_types_and_removed_eslint");
  } else if (fw === "vite") {
    finalType = ensureViteHomepage(files);
    changes.push("ensured_vite_index_and_vercel_json");
  } else {
    finalType = ensureStaticHomepage(files);
    changes.push("ensured_static_index");
  }

  return { files, framework: finalType, changes };
}
