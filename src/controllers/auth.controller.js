import { http } from "../config/axios.js";
import jwt from "jsonwebtoken";

const GH_AUTH = "https://github.com/login/oauth/authorize";
const GH_TOKEN = "https://github.com/login/oauth/access_token";
const GH_API = "https://api.github.com";

export const githubLogin = async (_req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: process.env.GITHUB_OAUTH_REDIRECT_URI,
    scope: "repo",
  });
  res.redirect(`${GH_AUTH}?${params.toString()}`);
};

export const githubCallback = async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: "missing code" });

  const { data: tokenData } = await http.post(
    GH_TOKEN,
    {
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: process.env.GITHUB_OAUTH_REDIRECT_URI,
    },
    { headers: { Accept: "application/json" } }
  );
  const access_token = tokenData.access_token;
  if (!access_token)
    return res
      .status(400)
      .json({ error: "failed to get token", details: tokenData });

  const { data: ghUser } = await http.get(`${GH_API}/user`, {
    headers: {
      Authorization: `Bearer ${access_token}`,
      Accept: "application/vnd.github+json",
    },
  });

  const sessionPayload = {
    id: ghUser.id,
    login: ghUser.login,
    githubToken: access_token,
  };
  const session = jwt.sign(sessionPayload, process.env.JWT_SECRET, {
    expiresIn: "12h",
  });

  res.cookie("session", session, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 12 * 3600 * 1000,
  });
  return res.json({ ok: true, user: { id: ghUser.id, login: ghUser.login } });
};

export const me = async (req, res) =>
  res.json({ user: { id: req.user.id, login: req.user.login } });

export const logout = async (_req, res) => {
  res.clearCookie("session");
  res.json({ ok: true });
};
