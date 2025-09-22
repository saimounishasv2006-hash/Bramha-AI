// src/services/llm.service.js
// Run Python generator; if it fails (quota, etc.), fall back to a minimal Next.js app
import fs from "node:fs";
import path from "node:path";
import { runPythonGenerator } from "./python-runner.js";

const PY_DIR = path.join(process.cwd(), "src", "engines", "python");

function minimalNextFiles({ projectName, idea }) {
  return [
    {
      path: "package.json",
      content:
        JSON.stringify(
          {
            name: projectName || "app",
            private: true,
            scripts: {
              dev: "next dev",
              build: "next build",
              start: "next start",
            },
            dependencies: { next: "^14", react: "^18", "react-dom": "^18" },
            devDependencies: { "@types/react": "^18", "@types/node": "^20" },
          },
          null,
          2
        ) + "\n",
    },
    {
      path: "next.config.js",
      content:
        `/** Auto-generated */\n` +
        `/** @type {import('next').NextConfig} */\n` +
        `const nextConfig = { reactStrictMode: true, eslint: { ignoreDuringBuilds: true } };\n` +
        `module.exports = nextConfig;\n`,
    },
    {
      path: "app/layout.tsx",
      content: `export const metadata = { title: "${(projectName || "App")
        .replace(/"/g, '\\"')
        .slice(0, 60)}" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body className="min-h-screen">{children}</body></html>);
}
`,
    },
    {
      path: "app/page.tsx",
      content: `export default function Page() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-semibold">It works 🎉</h1>
      <p className="mt-2 text-gray-600">${String(idea || "").slice(0, 200)}</p>
    </main>
  );
}
`,
    },
    {
      path: "tsconfig.json",
      content:
        JSON.stringify(
          {
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
          },
          null,
          2
        ) + "\n",
    },
    {
      path: "next-env.d.ts",
      content: `/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n`,
    },
  ];
}

export async function generateProjectFromIdea(
  idea,
  { engine = "frontend", projectName, overrides = {} } = {}
) {
  if (!idea || !idea.trim()) throw new Error("idea is required");

  const scriptMap = {
    frontend: path.join("src", "engines", "python", "frontend_generator.py"),
    backend: path.join("src", "engines", "python", "backend_generator.py"),
    fullstack: path.join("src", "engines", "python", "fullstack_generator.py"),
    web3: path.join("src", "engines", "python", "web3_generator.py"),
  };

  const isFrontendish = engine === "frontend" || engine === "fullstack";
  const scriptPath = scriptMap[engine] || scriptMap.frontend;

  try {
    const output = await runPythonGenerator({
      scriptPath,
      inputJson: { idea, project_name: projectName, ...overrides },
      cwd: PY_DIR, // make sure Python writes output.json where we expect
    });

    const files = Array.isArray(output?.files) ? output.files : [];
    if (!files.length) throw new Error("generator returned no files");

    // Frontendish goes to Vercel. Backend/Web3 may still be deployable if they emit static.
    return {
      engine,
      files,
      canDeployToVercel: isFrontendish,
      frameworkHint: isFrontendish ? "next" : "static",
      projectSettings: isFrontendish ? { framework: "nextjs" } : undefined,
    };
  } catch (err) {
    // Any error (quota, missing python, crash) → still produce a deployable app
    if (isFrontendish) {
      const files = minimalNextFiles({ projectName, idea });
      return {
        engine,
        files,
        canDeployToVercel: true,
        frameworkHint: "next",
        projectSettings: { framework: "nextjs" },
        fallback: true,
        error: String(err?.message || err),
      };
    }

    // Backend/Web3: give a static placeholder (so Vercel can still host something)
    const files = [
      {
        path: "index.html",
        content: `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${
          projectName || "Project"
        }</title><style>body{font-family:system-ui,Arial;padding:24px}</style></head><body><h1>${
          projectName || "Project"
        }</h1><p>Code generation failed or was rate-limited. Replace with your ${engine} app.</p></body></html>`,
      },
      {
        path: "package.json",
        content: JSON.stringify({ name: projectName || "app" }, null, 2) + "\n",
      },
    ];

    return {
      engine,
      files,
      canDeployToVercel: true, // static placeholder is deployable
      frameworkHint: "static",
      projectSettings: undefined,
      fallback: true,
      error: String(err?.message || err),
    };
  }
}
