#!/usr/bin/env bash
set -euo pipefail

# Generalized gemp script
# Usage: gemp <prompt-name> [initial-message] [extra gemini args...]

if [ $# -lt 1 ]; then
  echo "Usage: gemp <prompt-name> [initial-message] [extra gemini args...]" >&2
  echo "" >&2
  echo "Examples:" >&2
  echo "  gemp code-architect 'Refactor the auth service'" >&2
  echo "  gemp debugger 'Fix the race condition in orchestrator.ts'" >&2
  exit 1
fi

PROMPT_NAME="$1"
shift

# Check if next argument exists and doesn't start with - (so it's a message)
if [ $# -gt 0 ] && [[ ! "$1" =~ ^- ]]; then
  INITIAL_MESSAGE="$1"
  shift
else
  INITIAL_MESSAGE=""
fi

PROMPT_FILE="$HOME/.prompt-templates/${PROMPT_NAME}.prompt"

if [ ! -f "$PROMPT_FILE" ]; then
  echo "Prompt file not found: $PROMPT_FILE" >&2
  # Optional: Fallback to checking if the user provided a full path?
  # But for now, strict ~/.prompt-templates/ is fine as per request.
  exit 2
fi

echo "🔧 gemp: launching Gemini Code with prompt '${PROMPT_NAME}'"
echo "   prompt file: ${PROMPT_FILE}"
echo

# Create temporary file for system prompt
TEMP_SYSTEM_FILE=$(mktemp)
cat "$PROMPT_FILE" > "$TEMP_SYSTEM_FILE"
trap 'rm -f "$TEMP_SYSTEM_FILE"' EXIT

if [ -n "$INITIAL_MESSAGE" ]; then
  echo "💬 Initial message: ${INITIAL_MESSAGE}"
  echo "${INITIAL_MESSAGE}" | GEMINI_SYSTEM_MD="$TEMP_SYSTEM_FILE" gemini "$@"
else
  # If no initial message, just start gemini (interactive mode or whatever)
  # But gemini usually takes a prompt. 
  # If the user provides no message, they might be relying on the system prompt 
  # triggering the model, or they might want to type it interactively?
  # For now, let's just pass arguments. If stdin is empty, gemini might wait for input?
  GEMINI_SYSTEM_MD="$TEMP_SYSTEM_FILE" gemini "$@"
fi
