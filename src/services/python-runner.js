// src/services/python-runner.js
// Spawns a Python generator, passes input JSON via env, and returns parsed output.json

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";

export async function runPythonGenerator({
  scriptPath, // e.g. "src/engines/python/frontend_generator.py"
  inputJson, // JS object: { idea, project_name, ... }
  cwd = process.cwd(), // where output.json will be written
  waitFor = "output.json", // python script writes this file
} = {}) {
  if (!scriptPath) throw new Error("scriptPath is required");
  const fullScript = path.isAbsolute(scriptPath)
    ? scriptPath
    : path.join(cwd, scriptPath);

  // sanity: ensure the script file exists
  try {
    await fs.access(fullScript);
  } catch {
    throw new Error(`Generator not found at: ${fullScript}`);
  }

  // choose python executable
  const PY =
    process.env.PYTHON_BIN || path.join(cwd, ".venv", "Scripts", "python.exe"); // Windows venv default
  // fallback to "python" if the above doesn't exist would be OS-dependent, so keep it explicit

  // build env (pass the JSON)
  const env = {
    ...process.env,
    GEN_INPUT_JSON: JSON.stringify(inputJson || {}),
  };

  // run python
  const args = [fullScript];
  const stdio = ["ignore", "pipe", "pipe"];

  const result = await new Promise((resolve, reject) => {
    const ps = spawn(PY, args, { cwd, env, stdio });

    let out = "";
    let err = "";

    ps.stdout.on("data", (d) => (out += d.toString()));
    ps.stderr.on("data", (d) => (err += d.toString()));

    ps.on("error", (e) => reject(e));

    ps.on("close", async (code) => {
      if (code !== 0) {
        return reject(
          new Error(
            err ||
              `python exited ${code}\nSTDOUT:\n${out || "(empty)"}\nSTDERR:\n${
                err || "(empty)"
              }`
          )
        );
      }
      try {
        const outPath = path.join(cwd, waitFor);
        const buf = await fs.readFile(outPath, "utf-8");
        const json = JSON.parse(buf);
        resolve(json);
      } catch (e) {
        reject(
          new Error(
            `Could not read ${waitFor}: ${e.message}\nSTDOUT:\n${
              out || "(empty)"
            }\nSTDERR:\n${err || "(empty)"}`
          )
        );
      }
    });
  });

  return result; // e.g. { files: [{path, content}, ...] }
}
