import { step } from "../services/status.service.js";
import { generateProjectFromIdea } from "../services/llm.service.js";
import { pushFilesToRepo } from "../services/repo.service.js";

export const postFeedback = async (req, res) => {
  const authed = req.user;
  if (!authed?.githubToken)
    return res.status(401).json({ error: "login with GitHub first" });

  const { repo, idea, feedback } = req.body;
  if (!repo || !feedback || !idea)
    return res.status(400).json({ error: "repo, idea, feedback required" });

  try {
    const ownerLogin = repo.split("github.com/")[1].split("/")[0];
    const repoName = repo.split("/").pop();
    const { files } = await generateProjectFromIdea(idea, feedback);

    await pushFilesToRepo({
      token: authed.githubToken,
      ownerLogin,
      repoName,
      files,
    });

    step(repoName, "feedback_applied", { fileCount: files.length });
    return res.json({ ok: true, repo });
  } catch (e) {
    return res.status(500).json({ error: e?.response?.data || e.message });
  }
};
