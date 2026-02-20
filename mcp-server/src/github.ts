// ═══════════════════════════════════════════════════════════════
// GitHub API Client — Contents API for auto-delivery pipeline
// ═══════════════════════════════════════════════════════════════

const GITHUB_API = "https://api.github.com";
const COMMITTER = {
  name: "Command Center MCP",
  email: "noreply@cc-mcp.dev",
};

export interface GitHubCommitResult {
  sha: string;
  path: string;
  htmlUrl: string;
  commitSha: string;
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public body: string
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

/** Check if GitHub token is configured */
export function isGitHubConfigured(): boolean {
  return !!process.env.GITHUB_TOKEN;
}

/**
 * Resolve the final file path in a repo given document routing and app config.
 *
 * Rules:
 * - subPath is prepended if present (trimmed of leading/trailing slashes)
 * - targetPath leading slash is stripped
 *
 * Examples:
 *   ("claude-md", "CLAUDE.md", null)       → "CLAUDE.md"
 *   ("claude-md", "CLAUDE.md", "my-app")   → "my-app/CLAUDE.md"
 *   ("spec", "specs/f.md", "my-app")       → "my-app/specs/f.md"
 *   ("spec", "specs/f.md", "/my-app/")     → "my-app/specs/f.md"
 */
export function resolveTargetPath(
  _docType: string,
  targetPath: string,
  subPath: string | null
): string {
  // Clean targetPath
  let cleanTarget = targetPath.replace(/^\/+/, "");

  // Clean and prepend subPath if present
  if (subPath && subPath.trim() !== "") {
    const cleanSub = subPath.replace(/^\/+/, "").replace(/\/+$/, "");
    if (cleanSub) {
      cleanTarget = `${cleanSub}/${cleanTarget}`;
    }
  }

  return cleanTarget;
}

function getHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

/**
 * Get file SHA if it exists at the given path. Returns null on 404.
 */
export async function getFileSha(
  repo: string,
  path: string,
  branch: string = "main"
): Promise<string | null> {
  const url = `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`;
  const resp = await fetch(url, { headers: getHeaders() });

  if (resp.status === 404) return null;
  if (!resp.ok) {
    const body = await resp.text();
    throw new GitHubApiError(
      `Failed to get file ${path}: ${resp.status}`,
      resp.status,
      body
    );
  }

  const data = (await resp.json()) as { sha: string };
  return data.sha;
}

/**
 * Create or update a file via the Contents API.
 * PUT /repos/{owner}/{repo}/contents/{path}
 */
export async function commitFile(
  repo: string,
  path: string,
  content: string,
  message: string,
  sha: string | null,
  branch: string = "main"
): Promise<GitHubCommitResult> {
  const url = `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const body: Record<string, any> = {
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
    branch,
    committer: COMMITTER,
  };
  if (sha) body.sha = sha;

  const resp = await fetch(url, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const respBody = await resp.text();
    throw new GitHubApiError(
      `Failed to commit ${path}: ${resp.status}`,
      resp.status,
      respBody
    );
  }

  const data = (await resp.json()) as {
    content: { sha: string; path: string; html_url: string };
    commit: { sha: string };
  };

  return {
    sha: data.content.sha,
    path: data.content.path,
    htmlUrl: data.content.html_url,
    commitSha: data.commit.sha,
  };
}

/**
 * High-level: deliver a file to GitHub. Gets existing SHA, commits,
 * retries once on 409 conflict.
 */
export async function deliverToGitHub(
  repo: string,
  filePath: string,
  content: string,
  commitMessage: string,
  branch: string = "main"
): Promise<GitHubCommitResult> {
  let sha = await getFileSha(repo, filePath, branch);

  try {
    return await commitFile(repo, filePath, content, commitMessage, sha, branch);
  } catch (err) {
    if (err instanceof GitHubApiError && err.statusCode === 409) {
      // SHA conflict — retry once with fresh SHA
      sha = await getFileSha(repo, filePath, branch);
      return await commitFile(repo, filePath, content, commitMessage, sha, branch);
    }
    throw err;
  }
}
