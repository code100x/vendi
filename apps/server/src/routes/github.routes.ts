import { Router } from "express";
import { prisma } from "../lib/prisma";
import { decrypt } from "../lib/crypto";
import type { GitHubRepo } from "@vendi/shared";

const router = Router();

async function getGitHubToken(userId: string): Promise<string | null> {
  const account = await prisma.oAuthAccount.findFirst({
    where: { userId, provider: "github" },
  });

  if (!account) return null;

  // Token is stored as "encrypted|iv" format
  const [encrypted, iv] = account.accessToken.split("|");
  if (!encrypted || !iv) return null;

  return decrypt(encrypted, iv);
}

// GET /github/repos — list GitHub repositories accessible to the authenticated user
router.get("/repos", async (req, res) => {
  try {
    const userId = res.locals.user.id;
    const token = await getGitHubToken(userId);

    if (!token) {
      return res.status(400).json({ error: "GitHub account not linked" });
    }

    const response = await fetch(
      "https://api.github.com/user/repos?sort=updated&per_page=100&visibility=all",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Vendi-App",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("GitHub API error:", response.status, errorText);
      return res
        .status(response.status)
        .json({ error: "Failed to fetch repositories from GitHub" });
    }

    const data = await response.json();

    const repos: GitHubRepo[] = data.map((repo: any) => ({
      id: repo.id,
      fullName: repo.full_name,
      name: repo.name,
      owner: repo.owner.login,
      private: repo.private,
      defaultBranch: repo.default_branch,
      language: repo.language,
      url: repo.html_url,
    }));

    return res.json(repos);
  } catch (error) {
    console.error("Error fetching GitHub repos:", error);
    return res
      .status(500)
      .json({ error: "Failed to fetch GitHub repositories" });
  }
});

// GET /github/repos/:owner/:repo — get details for a specific GitHub repository
router.get("/repos/:owner/:repo", async (req, res) => {
  try {
    const userId = res.locals.user.id;
    const { owner, repo } = req.params;
    const token = await getGitHubToken(userId);

    if (!token) {
      return res.status(400).json({ error: "GitHub account not linked" });
    }

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Vendi-App",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("GitHub API error:", response.status, errorText);
      return res
        .status(response.status)
        .json({ error: "Failed to fetch repository from GitHub" });
    }

    const data = await response.json();

    const repoDetails: GitHubRepo = {
      id: data.id,
      fullName: data.full_name,
      name: data.name,
      owner: data.owner.login,
      private: data.private,
      defaultBranch: data.default_branch,
      language: data.language,
      url: data.html_url,
    };

    return res.json(repoDetails);
  } catch (error) {
    console.error("Error fetching GitHub repo:", error);
    return res
      .status(500)
      .json({ error: "Failed to fetch GitHub repository" });
  }
});

export default router;
