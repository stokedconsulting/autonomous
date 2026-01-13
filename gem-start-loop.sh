#!/usr/bin/env bash
set -euo pipefail

# Project-specific starter with continuous loop
# Usage: gem-start <project-number> [custom-message] [extra gemini args...]

if [ $# -lt 1 ]; then
  echo "Usage: gem-start <project-number> [custom-message] [extra gemini args...]" >&2
  echo "" >&2
  echo "Examples:" >&2
  echo "  gem-start 23" >&2
  echo "  gem-start 23 'Review Phase 1 security features'" >&2
  exit 1
fi

PROMPT_NAME="start-project"
PROJECT_NUMBER="$1"
shift 1

# Check if second argument looks like a custom message (not a flag)
if [ $# -gt 0 ] && [[ ! "$1" =~ ^- ]]; then
  CUSTOM_MESSAGE="$1"
  shift
else
  CUSTOM_MESSAGE=""
fi

PROMPT_FILE="$HOME/.prompt-templates/${PROMPT_NAME}.prompt"

if [ ! -f "$PROMPT_FILE" ]; then
  echo "Prompt file not found: $PROMPT_FILE" >&2
  exit 2
fi

BASE_PROMPT="$(cat "$PROMPT_FILE")"

# Determine directories
REPO_DIR="$PWD"
REPO_NAME=$(basename "$REPO_DIR")
PARENT_DIR=$(dirname "$REPO_DIR")

# Symlink Strategy to solve IDE Mismatch & Workspace Access
# 1. We create a hidden directory inside the text repo: .stoked-worktrees
# 2. We link the sibling worktree there.
# 3. We tell the agent to use the symlinked path.

WORKTREE_DIR=".stoked-worktrees"
LINK_NAME="project-${PROJECT_NUMBER}"
LINK_PATH="${WORKTREE_DIR}/${LINK_NAME}"
TARGET_WORKTREE_PATH="../${REPO_NAME}-project-${PROJECT_NUMBER}"

# Ensure dir exists
mkdir -p "$WORKTREE_DIR"

# Create/Update link (relative path for portability)
ln -sfn "$TARGET_WORKTREE_PATH" "$LINK_PATH"

# Add to gitignore if not present (simple check)
if [ -f .gitignore ] && ! grep -q "^${WORKTREE_DIR}$" .gitignore; then
  echo "${WORKTREE_DIR}" >> .gitignore
fi

APPEND_PROMPT=$(
cat <<EOF
CONTEXT / PATH INSTRUCTIONS:
To avoid workspace permission errors, access the project worktree via this standard path:

PATH: ${LINK_PATH}

DO NOT try to access "${TARGET_WORKTREE_PATH}" directly.
Always cd into ${LINK_PATH} or reference files via ${LINK_PATH}/...

YOUR FIRST ACTION MUST BE:
cd ${LINK_PATH}

Then proceed with the project prompt below.

IMPORTANT — PROJECT SELECTION IS NOT AMBIGUOUS.

You MUST operate ONLY on the GitHub Project with the following explicit number:

PROJECT NUMBER: ${PROJECT_NUMBER}

Do not attempt to infer or detect other project numbers. All work MUST be done inside this specific project.

---------------------------------------------------------------------

${BASE_PROMPT}

EOF
)

echo "🔧 gem-start: launching Gemini Code for project #${PROJECT_NUMBER}"
echo "   Repo: ${REPO_NAME}"
echo "   Worktree Link: ${LINK_PATH} -> ${TARGET_WORKTREE_PATH}"
echo

# Set the initial message
if [ -n "$CUSTOM_MESSAGE" ]; then
  INITIAL_MESSAGE="$CUSTOM_MESSAGE"
else
  INITIAL_MESSAGE="Begin working on GitHub Project #${PROJECT_NUMBER}. CD to ${LINK_PATH} first. Then identify the active Phase and its work items."
fi

# Create temporary file for system prompt
TEMP_SYSTEM_FILE=$(mktemp)
echo "${APPEND_PROMPT}" > "$TEMP_SYSTEM_FILE"
trap 'rm -f "$TEMP_SYSTEM_FILE"' EXIT

echo "💬 Initial message: ${INITIAL_MESSAGE}"
echo

# Loop for continuous execution
while true; do
  OUTPUT_FILE=$(mktemp)
  
  # Run in current directory (REPO_DIR) so IDE matches.
  # Agent uses symlink to access worktree.
  
  set +e
  # Using --yolo as requested/observed
  echo "${INITIAL_MESSAGE}" | GEMINI_SYSTEM_MD="$TEMP_SYSTEM_FILE" gemini --yolo "$@" | tee "$OUTPUT_FILE"
  GEMINI_EXIT=$?
  set -e
  
  # Check for completion marker
  if grep -q "PROJECT COMPLETE" "$OUTPUT_FILE"; then
     echo
     echo "✅ Project Complete detected."
     rm "$OUTPUT_FILE"
     break
  fi
  
  rm "$OUTPUT_FILE"
  
  echo
  echo "🔄 Status: 'PROJECT COMPLETE' not found yet."
  echo "♻️ Restarting agent in 5 seconds to continue work... (Press Ctrl+C to abort)"
  sleep 5
  
  INITIAL_MESSAGE="The previous session ended. Please continue working on GitHub Project #${PROJECT_NUMBER} inside ${LINK_PATH}. Check the status again and pick up the next item. If finished, output PROJECT COMPLETE."
done
