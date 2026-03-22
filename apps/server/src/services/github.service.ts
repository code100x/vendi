import { prisma } from "../lib/prisma";
import { decrypt } from "../lib/crypto";

async function getGithubToken(userId: string): Promise<string> {
  const account = await prisma.oAuthAccount.findFirst({
    where: { userId, provider: "github" },
  });
  if (!account) throw new Error("GitHub account not linked");

  const [encrypted, iv] = account.accessToken.split("|");
  return decrypt(encrypted, iv);
}

function githubApi(token: string) {
  return {
    async fetch(path: string, options: RequestInit = {}): Promise<Record<string, unknown>> {
      const res = await fetch(`https://api.github.com${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`GitHub API error ${res.status}: ${body}`);
      }
      return res.json() as Promise<Record<string, unknown>>;
    },
  };
}

export async function createBranch(
  userId: string,
  repoFullName: string,
  branchName: string,
  baseBranch: string
): Promise<void> {
  const token = await getGithubToken(userId);
  const api = githubApi(token);
  const [owner, repo] = repoFullName.split("/");

  // Get SHA of base branch
  const ref = (await api.fetch(
    `/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`
  )) as { object: { sha: string } };

  // Create new branch
  await api.fetch(`/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: ref.object.sha,
    }),
  });
}

export async function createPullRequest(
  userId: string,
  repoFullName: string,
  branchName: string,
  baseBranch: string,
  title: string,
  body: string
): Promise<string> {
  const token = await getGithubToken(userId);
  const api = githubApi(token);
  const [owner, repo] = repoFullName.split("/");

  const pr = (await api.fetch(`/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title,
      body,
      head: branchName,
      base: baseBranch,
    }),
  })) as { html_url: string };

  return pr.html_url;
}

export async function mergePullRequest(
  userId: string,
  repoFullName: string,
  prNumber: number
): Promise<string> {
  const token = await getGithubToken(userId);
  const api = githubApi(token);
  const [owner, repo] = repoFullName.split("/");

  const result = (await api.fetch(
    `/repos/${owner}/${repo}/pulls/${prNumber}/merge`,
    {
      method: "PUT",
      body: JSON.stringify({ merge_method: "squash" }),
    }
  )) as { sha: string };

  return result.sha;
}

export async function deleteBranch(
  userId: string,
  repoFullName: string,
  branchName: string
): Promise<void> {
  const token = await getGithubToken(userId);
  const api = githubApi(token);
  const [owner, repo] = repoFullName.split("/");

  await api
    .fetch(`/repos/${owner}/${repo}/git/refs/heads/${branchName}`, {
      method: "DELETE",
    })
    .catch(() => {}); // Ignore if branch doesn't exist
}
