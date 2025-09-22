

import os
import re
import json
import time
import pathlib
import shutil
import glob
from typing import Dict, Any, List


from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage


API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    raise RuntimeError("Set GEMINI_API_KEY in your environment.")

llm = ChatGoogleGenerativeAI(
    model="gemini-1.5-flash",
    api_key=API_KEY,
    temperature=0.2,
    top_p=0.9,
    top_k=32,
    max_output_tokens=8192,
)

def llm_generate(prompt: str) -> str:
    """
    Simple wrapper that returns plain string content from Gemini via LangChain.
    """
    res = llm.invoke([HumanMessage(content=prompt)])
    content = getattr(res, "content", None)
    return (content if isinstance(content, str) else str(res)).strip()

# ----------------- Input JSON -----------------
raw = os.getenv("GEN_INPUT_JSON")
if not raw:
    raise RuntimeError('GEN_INPUT_JSON is required, e.g. {"idea":"Build me an ecommerce app with products page"}')

try:
    user_json = json.loads(raw)
except Exception as e:
    raise ValueError(f"GEN_INPUT_JSON must be valid JSON. Error: {e}")

IDEA = (user_json.get("idea") or "").strip()
if not IDEA:
    raise ValueError('GEN_INPUT_JSON must include: { "idea": "..." }')

def slug(s: str, fallback: str = "frontend-app") -> str:
    s = re.sub(r"[^a-zA-Z0-9\s-]+", "", s).strip().lower()
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"-+", "-", s)
    return (s or fallback)[:40]

project_name = (user_json.get("project_name") or slug(IDEA)).lower()

framework = user_json.get("framework") or "Next.js 14 (App Router, TypeScript)"
ui_stack  = user_json.get("ui_stack")  or "Tailwind CSS"

brand_in = user_json.get("brand") or {}
brand: Dict[str, Any] = {
    "appName":   (brand_in.get("appName")   or "App"),
    "primary":   (brand_in.get("primary")   or "#3b82f6"),
    "secondary": (brand_in.get("secondary") or "#0ea5e9"),
}

# Optional: auto-create project folder
if os.getenv("GEN_CREATE_DIR", "1") == "1":
    os.makedirs(project_name, exist_ok=True)

print(" Inputs captured")
print("• idea:", IDEA)
print("• project_name:", project_name)
print("• framework:", framework)
print("• ui_stack:", ui_stack)
print("• brand:", brand)

# ----------------- Helpers -----------------
def extract_fenced_block(text: str) -> str:
    """
    Return first fenced code block content if present, else the text itself.
    Handles ```<lang>\n<code>``` and ```\n<code>```.
    """
    if not text:
        return ""
    text = text.strip()
    fence = "```"
    if fence not in text:
        return text
    parts = text.split(fence)
   
    for i in range(1, len(parts), 2):
        block = parts[i]
        if "\n" in block:
            _lang, rest = block.split("\n", 1)
            if rest.strip():
                return rest.strip()
        elif block.strip():
            return block.strip()
   
    return parts[1].strip() if len(parts) > 1 else text

def sanitize_markdown_block(s: str) -> str:
    return extract_fenced_block(s)

def safe_llm_generate(prompt: str, max_retries: int = 2, delay: float = 0.6) -> str:
    last = ""
    for attempt in range(max_retries + 1):
        try:
            txt = llm_generate(prompt)
            code = extract_fenced_block(txt)
            if code and len(code.strip()) > 5:
                return code.strip()
            last = txt
        except Exception as e:
            last = f"[error:{e}]"
        time.sleep(delay)
    return last.strip()


SPEC_PROMPT = f"""
You are an expert frontend architect.
Goal: Convert this idea into a SPEC for a {framework} + {ui_stack} app.

Idea:
{IDEA}

Return STRICT JSON with this shape (and nothing else):

{{
  "appName": "string",
  "routes": [
    {{
      "path": "string",                // e.g. "/"
      "title": "string",
      "description": "string",
      "layout": "marketing" | "dashboard" | "plain",
      "sections": [
        {{
          "id": "string",
          "kind": "hero" | "features" | "pricing" | "faq" | "contact" | "cta" | "custom",
          "details": {{
            "headline": "string",
            "subheadline": "string",
            "items": [{{"title":"string","body":"string"}}]
          }}
        }}
      ]
    }}
  ],
  "components": [
    {{
      "name": "string",
      "props": [{{"name":"string","type":"string","optional":true}}],
      "description": "string"
    }}
  ],
  "theme": {{
    "primary": "{brand['primary']}",
    "secondary": "{brand['secondary']}"
  }}
}}
"""

spec_text = safe_llm_generate(SPEC_PROMPT)
spec_json_str = extract_fenced_block(spec_text)
spec = json.loads(spec_json_str)
spec["appName"] = spec.get("appName") or brand["appName"]

print(" SPEC ready")
print(json.dumps(spec, indent=2)[:2000])


BASE_FILES: Dict[str, Dict[str, str]] = {
  
    "package.json": {
        "prompt": """Create a minimal package.json for a Next.js 14 + TypeScript + Tailwind app.
- Scripts: dev, build, start, lint
- Dependencies: next, react, react-dom
- DevDeps: typescript, eslint, prettier, tailwindcss, postcss, autoprefixer
- "type":"module"
- Name should be a safe NPM name from appName
Return only the JSON content."""
    },
    "tsconfig.json": {
        "prompt": "Provide a tsconfig.json suitable for a Next.js 14 app with strict TypeScript enabled (app router)."
    },
    "next.config.ts": {
        "prompt": "Provide a Next.js 14 next.config.ts with minimal config and strict mode enabled."
    },
    "postcss.config.js": {
        "prompt": "Provide a minimal PostCSS config for Tailwind CSS."
    },
    "tailwind.config.ts": {
        "prompt": f"""Provide Tailwind config (TypeScript) with content paths for App Router (./app/**/*).
Use brand colors: primary {brand['primary']}, secondary {brand['secondary']}.
Enable container plugin and sensible defaults."""
    },
    ".eslintrc.json": {
        "prompt": "Provide a minimal ESLint config JSON for Next.js + TypeScript with recommended rules."
    },
    ".prettierrc": {
        "prompt": "Provide a minimal Prettier config JSON."
    },

    # app router base
    "app/layout.tsx": {
        "prompt": f"""Create a root layout.tsx for Next.js App Router.
- Use Tailwind
- Set metadata title from spec.appName
- <html lang="en"><body className="min-h-screen bg-white text-gray-900">{'{children}'}</body></html>"""
    },
    "app/globals.css": {
        "prompt": "Provide Tailwind base, components, utilities imports and a few CSS vars for theme."
    },
    "app/page.tsx": {
        "prompt": """Generate the homepage ("/") using the SPEC routes[0] content:
- Compose sections (hero/features/pricing/faq/contact/cta/custom) using simple functional components inline or imported
- Use accessible, semantic markup with Tailwind classes
- Export default function Page()"""
    },

    # components
    "components/Header.tsx": {
        "prompt": "Create a Header with app name, nav links from SPEC routes, and a CTA button; responsive with Tailwind."
    },
    "components/Footer.tsx": {
        "prompt": "Create a minimalist Footer with copyright and simple links."
    },
}

def additional_route_files(spec_obj: Dict[str, Any]) -> Dict[str, Dict[str, str]]:
    out: Dict[str, Dict[str, str]] = {}
    for r in spec_obj.get("routes", []):
        path_val = r.get("path")
        if not path_val or path_val == "/":
            continue
        name = path_val.strip("/").replace("/", "-") or "index"
        out[f"app/{name}/page.tsx"] = {
            "prompt": f"""Generate a page for route "{r['path']}" using this route object:

{json.dumps(r, indent=2)}

- Use Tailwind
- Build sections based on 'sections' with accessible markup
- Export default function Page()"""
        }
    return out

EXTRA_FILES = additional_route_files(spec)
print(f"Base files: {len(BASE_FILES)} | Extra pages: {len(EXTRA_FILES)}")

# ----------------- File Generation -----------------
def file_prompt(file_path: str, file_spec_prompt: str, spec_obj: Dict[str, Any]) -> str:
    return f"""
You are a senior {framework} engineer.

### File Path
{file_path}

### Project SPEC (JSON)
{json.dumps(spec_obj, indent=2)}

### Requirements
- Produce the FULL, final content for this file ONLY.
- Use TypeScript and Next.js App Router conventions.
- Use Tailwind classes for styling.
- Keep code self-contained and import local components relatively.
- Do NOT add explanations.

### Write the file now:
{file_spec_prompt}
""".strip()

def generate_file(path_rel: str, file_spec_prompt: str, write_dir: str) -> str:
    full_prompt = file_prompt(path_rel, file_spec_prompt, spec)
    content = safe_llm_generate(full_prompt)
    if not content or len(content.strip()) == 0:
        content = f"// Fallback stub for {path_rel}\n"
    out_path = pathlib.Path(write_dir) / path_rel
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(content, encoding="utf-8")
    return str(out_path)

def build_project_safe(write_dir: str, base: Dict[str, Dict[str, str]], extra: Dict[str, Dict[str, str]]) -> List[str]:
    created: List[str] = []
    # generate base + extra
    for path_rel, meta in {**base, **extra}.items():
        p = generate_file(path_rel, meta["prompt"], write_dir)
        created.append(p)
    # README
    readme = f"""# {spec.get('appName', brand.get('appName','App'))}

Generated by a Gemini-powered frontend generator.
Stack: {framework} + {ui_stack}

## Run locally
npm i
npm run dev

## Routes
{os.linesep.join(['- ' + (r.get('path') or '/') + ' — ' + (r.get('title') or '') for r in spec.get('routes', [])])}
"""
    pathlib.Path(write_dir, "README.md").write_text(readme, encoding="utf-8")
    created.append(str(pathlib.Path(write_dir, "README.md")))
    return created

# ----------------- Build -----------------
CLEAN_BUILD = True
if CLEAN_BUILD and os.path.isdir(project_name):
    shutil.rmtree(project_name)
os.makedirs(project_name, exist_ok=True)

# clean previous zips (if any)
for p in glob.glob(f"{project_name}.zip"):
    try: os.remove(p)
    except: pass

print(" Generating files...")
created_files = build_project_safe(project_name, BASE_FILES, EXTRA_FILES)
print(f" Generated {len(created_files)} files")

# ----------------- Collect -> output.json -----------------
files_out: List[Dict[str, str]] = []
for root, _, files in os.walk(project_name):
    for f in files:
        p = os.path.join(root, f)
        if os.path.getsize(p) > 0:
            rel_path = os.path.relpath(p, project_name)
            with open(p, "r", encoding="utf-8") as fh:
                content = fh.read()
            files_out.append({"path": rel_path, "content": content})

if not files_out:
    raise RuntimeError("No non-empty files were generated.")

output = {"files": files_out}
with open("output.json", "w", encoding="utf-8") as out_f:
    json.dump(output, out_f, ensure_ascii=False, indent=2)

print(" Saved output.json")
print(" Done.")
