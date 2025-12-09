# Rivet

AI-powered git commit and PR creation using Cursor Agent SDK.

## Features

✨ **Beautiful CLI** with colors, spinners, and progress indicators  
📊 **Smart summaries** showing files changed and commits  
🤖 **AI-powered** commit messages and PR content  
⚡ **Fast** single agent call per command  
🎯 **Conventional commits** format support  

## Installation

```bash
bun install
```

## Setup

### Quick Setup (Recommended)

Run the interactive setup:

```bash
bun index.ts init
```

This will create a `rivet.config.json` file in your project with your configuration.

### Manual Setup

Alternatively, set your Cursor API key as an environment variable:

```bash
export CURSOR_API_KEY=your_api_key_here
```

For PR creation, ensure you have GitHub CLI (`gh`) installed and authenticated:

```bash
gh auth login
```

## Usage

### Init Command

Initialize rivet configuration for your project:

```bash
bun index.ts init
```

This interactive setup allows you to configure:
- Cursor API key (saved to `.rivetrc.json`)
- Default model (auto, gpt-4o, gpt-4.1)
- Default base branch for PRs

**Note:** The config file (`rivet.config.json`) is gitignored by default to protect your API key.

### Commit Command

Create a commit with an AI-generated message:

```bash
# Commit (asks for confirmation)
bun index.ts c

# Skip confirmation
bun index.ts c --yes

# Skip git hooks
bun index.ts c --no-verify
```

**What you'll see:**
- ✅ Repository check
- 📊 Summary of files changed
- 🤖 AI generating commit message
- 📝 Formatted commit message preview
- ✅ Commit created

### PR Command

Create a GitHub PR with AI-generated title, description, and labels:

```bash
# Create PR (asks for confirmation)
bun index.ts pr

# Skip confirmation
bun index.ts pr --yes

# Specify base branch
bun index.ts pr --base develop

# Create as draft PR
bun index.ts pr --draft
```

**What you'll see:**
- ✅ Repository and GitHub CLI checks
- 📊 Summary of changes (files, commits)
- 🤖 AI generating PR content
- 📋 Formatted PR preview (title, labels, description)
- ✅ PR created with link

## How It Works

1. **Commit**: Analyzes your git diff and generates a commit message using the Cursor Agent SDK
2. **Raise PR**: Analyzes branch changes and generates PR title, description, and labels using the Cursor Agent SDK

Both commands use a single agent call that includes all necessary context (git diff, branch info, commits) to generate appropriate content.

## Configuration

Rivet can be configured in two ways:

### 1. Config File (`.rivetrc.json`)

Created by running `rivet init`. Example (`rivet.config.json`):

```json
{
  "apiKey": "your_cursor_api_key",
  "model": "auto",
  "defaultBaseBranch": "main"
}
```

### 2. Environment Variables

- `CURSOR_API_KEY` (required if not in config) - Your Cursor API key
- `RIVET_MODEL` (optional) - Model to use (default: `auto` - works for free users. Premium users can use `gpt-4o`)

**Priority:** Config file > Environment variables > Defaults

## Requirements

- Bun runtime
- Git repository
- GitHub CLI (`gh`) for PR creation
- Cursor API key
