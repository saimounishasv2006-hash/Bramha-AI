# engines/python/backend_generator.py
import sys, json, os, re, pathlib
from typing import Dict, Any, List


import time, zipfile, shutil
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage
from langchain_core.prompts import PromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI


load_dotenv()

class BackendProjectGenerator:
    def __init__(self):
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY missing")
        self.llm = ChatGoogleGenerativeAI(
            model="gemini-1.5-flash",
            google_api_key=api_key,
            temperature=0.2, top_p=0.9, top_k=32, max_output_tokens=8192
        )
        self.api_call_count = 0
        self.default_config = {
            "framework": "Node.js + Express + TypeScript",
            "db_stack": "PostgreSQL + Prisma",
            "brand": {"appName": "MyApp"}
        }

    def load_frontend_input(self, data: Dict[str, Any]) -> Dict[str, Any]:
        idea = data.get("idea", "").strip()
        if not idea:
            raise ValueError("idea is required")
        proj = data.get("project_name") or "-".join(idea.split()[:3]).lower() or "backend-project"
        return {
            "project_idea": idea,
            "project_name": proj,
            **self.default_config
        }

    def _extract_code_block(self, text: str) -> str:
        # pull ```json ... ``` else raw text
        m = re.search(r"```(?:json|JSON)?\s*([\s\S]+?)```", text)
        return m.group(1).strip() if m else text

    def generate_spec(self, cfg: Dict[str, Any]) -> Dict[str, Any]:
        p = PromptTemplate(
            input_variables=["project_idea", "framework", "db_stack"],
            template=(
                "You are an expert backend architect.\n"
                "Goal: Convert this idea into a SPEC for a {framework} + {db_stack} backend.\n\n"
                "Idea:\n{project_idea}\n\n"
                "Return STRICT JSON with this shape (and nothing else):\n"
                "{\n"
                '  "appName": "string",\n'
                '  "endpoints": [ { "path": "string", "method":"GET", "description":"string", "params":[{"name":"id","type":"string","required":true}], "response":"string" } ],\n'
                '  "models": [ { "name":"Task", "fields":[{"name":"id","type":"string","required":true}] } ],\n'
                '  "database": "' + cfg["db_stack"] + '"\n'
                "}\n"
            )
        )
        prompt = p.format(project_idea=cfg["project_idea"], framework=cfg["framework"], db_stack=cfg["db_stack"])
        resp = self.llm.invoke([HumanMessage(content=prompt)])
        spec_str = self._extract_code_block(resp.content.strip())
        spec = json.loads(spec_str)
        if not spec.get("appName"):
            spec["appName"] = cfg["brand"]["appName"]
        return spec

    # ----- minimal file set just to demonstrate end-to-end -----
    def build_minimal_files(self, cfg: Dict[str, Any], spec: Dict[str, Any]) -> List[Dict[str, str]]:
        app = spec["appName"]
        files = []

        pkg = {
            "name": app.lower().replace(" ", "-"),
            "private": True,
            "type": "module",
            "scripts": {
                "dev": "nodemon src/index.ts",
                "build": "tsc",
                "start": "node dist/index.js"
            },
            "dependencies": {"express": "^5.1.0", "cors": "^2.8.5", "dotenv": "^16"},
            "devDependencies": {"typescript": "^5", "ts-node": "^10", "nodemon": "^3"}
        }
        files.append({"path": "package.json", "content": json.dumps(pkg, indent=2)})

        files.append({
            "path": "tsconfig.json",
            "content": json.dumps({
                "compilerOptions": {
                    "target": "ES2022", "module": "ES2022", "moduleResolution": "Node",
                    "outDir": "dist", "rootDir": "src", "strict": True, "esModuleInterop": True
                },
                "include": ["src"]
            }, indent=2)
        })

        files.append({
            "path": "src/index.ts",
            "content": (
                'import "dotenv/config";\n'
                'import express from "express";\n'
                'import cors from "cors";\n'
                'const app = express();\n'
                'app.use(cors());\n'
                'app.use(express.json());\n'
                'app.get("/", (_req, res) => res.json({ ok: true, service: "backend" }));\n'
                'app.listen(process.env.PORT || 4000, () => console.log("API on :" + (process.env.PORT || 4000)));\n'
            )
        })

        # Readme
        files.append({
            "path": "README.md",
            "content": f"# {app}\n\nGenerated backend.\n\nRun:\n\n```bash\nnpm i\nnpm run dev\n```"
        })

        return files

    def generate(self, input_json: Dict[str, Any]) -> Dict[str, Any]:
        cfg = self.load_frontend_input(input_json)
        spec = self.generate_spec(cfg)
        files = self.build_minimal_files(cfg, spec)
        # Backend projects are not deployed to Vercel in this flow
        return {
            "files": files,
            "frameworkHint": None,
            "canDeployToVercel": False,
            "projectSettings": None
        }

# ------------------ CLI ------------------
def main():
    raw = sys.stdin.read() or "{}"
    payload = json.loads(raw)
    gen = BackendProjectGenerator()
    out = gen.generate(payload)
    print(json.dumps(out))

if __name__ == "__main__":
    main()
