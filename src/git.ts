// Git helper functions
export async function getStagedDiff(): Promise<string> {
  const result = await Bun.$`git diff --cached`.quiet();
  return result.stdout.toString();
}

export async function getStagedFiles(): Promise<string[]> {
  try {
    const result = await Bun.$`git diff --cached --name-only`.quiet();
    return result.stdout.toString().trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export async function getCurrentBranch(): Promise<string> {
  const result = await Bun.$`git branch --show-current`.quiet();
  return result.stdout.toString().trim();
}

export async function getBranchDiff(baseBranch: string): Promise<string> {
  const result = await Bun.$`git diff ${baseBranch}...HEAD`.quiet();
  return result.stdout.toString();
}

export async function getBranchCommits(baseBranch: string): Promise<string> {
  const result = await Bun.$`git log ${baseBranch}..HEAD --oneline`.quiet();
  return result.stdout.toString();
}

export async function getChangedFilesCount(baseBranch: string): Promise<number> {
  try {
    const result = await Bun.$`git diff --name-only ${baseBranch}...HEAD`.quiet();
    const files = result.stdout.toString().trim().split("\n").filter(Boolean);
    return files.length;
  } catch {
    return 0;
  }
}

export async function getChangedFiles(baseBranch: string): Promise<string[]> {
  try {
    const result = await Bun.$`git diff --name-only ${baseBranch}...HEAD`.quiet();
    return result.stdout.toString().trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export async function hasUncommittedChanges(): Promise<boolean> {
  try {
    const result = await Bun.$`git status --porcelain`.quiet();
    return result.stdout.toString().trim().length > 0;
  } catch {
    return false;
  }
}

export async function createCommit(message: string, noVerify = false): Promise<void> {
  const flags = noVerify ? ["--no-verify"] : [];
  await Bun.$`git commit -m ${message} ${flags}`;
}

export async function getBaseBranch(): Promise<string> {
  // Try main first, then master
  try {
    await Bun.$`git show-ref --verify --quiet refs/heads/main`.quiet();
    return "main";
  } catch {
    return "master";
  }
}

export async function hasUpstream(): Promise<boolean> {
  try {
    await Bun.$`git rev-parse --abbrev-ref @{upstream}`.quiet();
    return true;
  } catch {
    return false;
  }
}

export async function pushToRemote(branch: string, setUpstream: boolean = false): Promise<void> {
  const flags = setUpstream ? ["-u", "origin", branch] : [];
  await Bun.$`git push ${flags}`;
}

import type { FileChangeStats } from "./types";

// PR template helper
export async function getPRTemplate(): Promise<string | null> {
  const templatePath = ".github/PULL_REQUEST_TEMPLATE.md";
  try {
    const file = Bun.file(templatePath);
    if (await file.exists()) {
      return await file.text();
    }
  } catch {
    // Ignore errors, template doesn't exist
  }
  return null;
}



export async function getStagedStats(): Promise<FileChangeStats[]> {
  try {
    const result = await Bun.$`git diff --cached --numstat`.quiet();
    const lines = result.stdout.toString().trim().split("\n").filter(Boolean);

    return lines.map(line => {
      const parts = line.split("\t");
      if (parts.length !== 3) return null;

      const insertions = parts[0] || "0";
      const deletions = parts[1] || "0";
      const file = parts[2];
      if (!file) return null;

      return {
        file,
        insertions: parseInt(insertions, 10) || 0,
        deletions: parseInt(deletions, 10) || 0,
      };
    }).filter((item): item is FileChangeStats => item !== null);
  } catch {
    return [];
  }
}

export async function getBranchStats(baseBranch: string): Promise<FileChangeStats[]> {
  try {
    const result = await Bun.$`git diff --numstat ${baseBranch}...HEAD`.quiet();
    const lines = result.stdout.toString().trim().split("\n").filter(Boolean);

    return lines.map(line => {
      const parts = line.split("\t");
      if (parts.length !== 3) return null;

      const insertions = parts[0] || "0";
      const deletions = parts[1] || "0";
      const file = parts[2];
      if (!file) return null;

      return {
        file,
        insertions: parseInt(insertions, 10) || 0,
        deletions: parseInt(deletions, 10) || 0,
      };
    }).filter((item): item is FileChangeStats => item !== null);
  } catch {
    return [];
  }
}