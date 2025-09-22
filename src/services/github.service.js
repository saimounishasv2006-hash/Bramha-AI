// src/services/github.service.js
import { http } from "../config/axios.js";

/** ownerRepo: "owner/repo" -> returns numeric GitHub repository id */
export async function getGithubRepoId(ownerRepo, githubToken) {
  const headers = {
    "User-Agent": "autoapp",
    Accept: "application/vnd.github+json",
  };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

  const { data } = await http.get(`https://api.github.com/repos/${ownerRepo}`, {
    headers,
  });
  return data.id; // numeric id
}
