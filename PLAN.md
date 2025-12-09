# Rivet CLI - MVP Implementation Plan (1 Hour)

## Overview
A minimal CLI tool with two commands using Cursor Agent SDK. **Single agent approach** - one agent call per command that does everything.

## Commands

### 1. `rivet commit`
Creates a commit with an AI-generated commit message.

### 2. `rivet raise-pr`
Creates a GitHub PR with AI-generated title, description, and labels.

## MVP Simplifications

✅ **Single agent** - One agent call per command (no separate context/generation agents)  
✅ **Simple file structure** - Minimal files, inline utilities  
✅ **Manual CLI parsing** - No commander, just parse args  
✅ **Use `gh` CLI** - Faster than Octokit setup  
✅ **Env vars only** - No config files  
✅ **No preview** - Just execute  
✅ **Basic error handling** - Validate essentials only

## MVP Project Structure (Minimal)

```
rivet/
├── index.ts          # Main CLI - everything in one file
├── package.json
└── tsconfig.json
```

**That's it!** Keep it simple for MVP.

## Dependencies

### Required
- `@cursor-ai/january` - Already installed ✓
- `commander` - CLI argument parsing (fast setup)
- Use `gh` CLI via `Bun.$` for GitHub operations (requires `gh` installed)

## MVP Implementation (Single File: `index.ts`)

### Structure (all in one file)

```typescript
// 1. Imports
import { CursorAgent } from "@cursor-ai/january";

// 2. Simple CLI parsing
const args = process.argv.slice(2);
const command = args[0];

// 3. Git helpers (inline functions)
async function getGitDiff() { /* Bun.$`git diff` */ }
async function getCurrentBranch() { /* Bun.$`git branch --show-current` */ }
async function createCommit(msg) { /* Bun.$`git commit -m ${msg}` */ }

// 4. GitHub helpers (using gh CLI)
async function createPR(title, body, labels) { 
  /* Bun.$`gh pr create --title "${title}" --body "${body}" --label "${labels}"` */ 
}

// 5. Commit command
async function commitCommand() {
  // Get diff
  // Get branch
  // Call agent with prompt: "Create commit message for these changes: [diff]"
  // Extract message from agent response
  // Run git commit
}

// 6. PR command  
async function raisePRCommand() {
  // Get diff vs base branch
  // Get branch name
  // Call agent with prompt: "Create PR title, description, and labels for: [diff]"
  // Parse agent response (title, body, labels)
  // Run gh pr create
}

// 7. Main
if (command === "commit") commitCommand();
else if (command === "raise-pr" || command === "pr") raisePRCommand();
```

### Commit Command Flow (MVP)

1. Get staged diff: `Bun.$`git diff --cached``
2. Get branch: `Bun.$`git branch --show-current``
3. **Single agent call** with prompt:
   ```
   Analyze these git changes and create a commit message.
   
   Branch: {branch}
   Diff:
   {diff}
   
   Return ONLY a commit message (subject line + optional body).
   ```
4. Extract message from agent response
5. Run: `Bun.$`git commit -m "${message}"``

### Raise PR Command Flow (MVP)

1. Get current branch: `Bun.$`git branch --show-current``
2. Get diff vs main: `Bun.$`git diff main...HEAD``
3. Get commits: `Bun.$`git log main..HEAD --oneline``
4. **Single agent call** with prompt:
   ```
   Create a GitHub PR for these changes.
   
   Branch: {branch}
   Commits: {commits}
   Diff: {diff}
   
   Return JSON:
   {
     "title": "PR title",
     "body": "PR description",
     "labels": ["label1", "label2"]
   }
   ```
5. Parse JSON from agent response
6. Run: `Bun.$`gh pr create --title "${title}" --body "${body}" --label "${labels.join(',')}"``

### Agent Prompt Strategy

**One prompt per command** that includes:
- Git context (diff, branch, commits)
- Clear instruction (create commit message OR create PR JSON)
- Format specification (plain text for commit, JSON for PR)

No separate context gathering - agent SDK handles file reading automatically.

## MVP Implementation Steps (1 Hour)

### Step 1: Setup (5 min)
1. ✅ Update `package.json` with bin entry
2. ✅ Create single `index.ts` file
3. ✅ Add basic CLI arg parsing

### Step 2: Git Helpers (10 min)
1. ✅ Functions: `getStagedDiff()`, `getCurrentBranch()`, `getBranchDiff()`
2. ✅ Function: `createCommit(message)`
3. ✅ Test git operations work

### Step 3: Commit Command (20 min)
1. ✅ Get diff and branch info
2. ✅ Initialize CursorAgent
3. ✅ Create prompt with git context
4. ✅ Call agent and extract message
5. ✅ Execute git commit
6. ✅ Test end-to-end

### Step 4: PR Command (20 min)
1. ✅ Get branch diff and commits
2. ✅ Create PR prompt (request JSON output)
3. ✅ Call agent and parse JSON
4. ✅ Execute `gh pr create` with parsed data
5. ✅ Test end-to-end

### Step 5: Polish (5 min)
1. ✅ Basic error handling (check CURSOR_API_KEY, git repo)
2. ✅ Simple help text
3. ✅ Test both commands

## Environment Variables

```bash
CURSOR_API_KEY=your_cursor_api_key  # Required
GITHUB_TOKEN=your_github_token      # Required for PR creation
RIVET_MODEL=gpt-4o                  # Optional, defaults to gpt-4o
```

## MVP Usage

```bash
# Commit with AI-generated message
rivet commit

# Raise PR with AI-generated content
rivet raise-pr
```

**That's it for MVP!** Keep it simple.

## MVP Error Handling

- ✅ Check `CURSOR_API_KEY` env var exists
- ✅ Check we're in a git repo
- ✅ Check there are changes to commit
- ✅ Basic try/catch with error messages

## Key MVP Decisions

1. **Single file** - Faster to implement, easier to debug
2. **Single agent call** - No complex orchestration
3. **Use `gh` CLI** - No API setup needed (user must have `gh` installed)
4. **No preview** - Just execute (can add later)
5. **Simple prompts** - Direct instructions, no complex context gathering
6. **JSON parsing for PR** - Agent returns structured data

## Time Estimate

- Setup: 5 min
- Git helpers: 10 min  
- Commit command: 20 min
- PR command: 20 min
- Polish: 5 min
**Total: ~60 minutes**
