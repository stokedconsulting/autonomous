#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: gemp <prompt-name> <project-number> [custom-message] [extra gemini args...]" >&2
  echo "" >&2
  echo "Examples:" >&2
  echo "  gemp project 23" >&2
  echo "  gemp project 23 'Review Phase 1 security features'" >&2
  echo "  gemp project 23 'Start with authentication work'" >&2
  exit 1
fi

PROMPT_NAME="$1"
PROJECT_NUMBER="$2"
shift 2

# Check if third argument looks like a custom message (not a flag)
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

APPEND_PROMPT=$(
cat <<EOF
IMPORTANT — PROJECT SELECTION IS NOT AMBIGUOUS.

You MUST operate ONLY on the GitHub Project with the following explicit number:

PROJECT NUMBER: ${PROJECT_NUMBER}

Do not attempt to infer or detect other project numbers. All work MUST be done inside this specific project.

---------------------------------------------------------------------

${BASE_PROMPT}
EOF
)

echo "🔧 gemp: launching Gemini Code with prompt '${PROMPT_NAME}' for project #${PROJECT_NUMBER}"
echo "   prompt file: ${PROMPT_FILE}"
echo "   (instructions appended to Gemini Code's system prompt)"
echo

# Dump the full system prompt so you can see it
echo "--------- BEGIN APPENDED SYSTEM PROMPT ---------"
echo "${APPEND_PROMPT}"
echo "---------- END APPENDED SYSTEM PROMPT ----------"
echo

# Set the initial message (custom or default)
if [ -n "$CUSTOM_MESSAGE" ]; then
  INITIAL_MESSAGE="$CUSTOM_MESSAGE"
else
  INITIAL_MESSAGE="Begin working on GitHub Project #${PROJECT_NUMBER}. Start by identifying the active Phase and its work items."
fi

# Create temporary file for system prompt (Gemini uses GEMINI_SYSTEM_MD env var)
TEMP_SYSTEM_FILE=$(mktemp)
echo "${APPEND_PROMPT}" > "$TEMP_SYSTEM_FILE"

# Make sure to clean up temp file on exit
trap 'rm -f "$TEMP_SYSTEM_FILE"' EXIT

echo "💬 Initial message: ${INITIAL_MESSAGE}"
echo

# Loop for continuous execution
while true; do
  OUTPUT_FILE=$(mktemp)
  
  # Temporarily disable exit on error effectively for the command execution, but preserving script safety
  # We pipe into tee so we see output. We need pipefail off for this segment if we want to catch exit code of gemini nicely,
  # but strictly speaking if gemini fails we still want to continue loop unless it's a critical logic error.
  # But assuming "stops working" captures crashes too.
  
  set +e
  echo "${INITIAL_MESSAGE}" | GEMINI_SYSTEM_MD="$TEMP_SYSTEM_FILE" gemini --yolo "$@" | tee "$OUTPUT_FILE"
  GEMINI_EXIT=$?
  set -e
  
  # Check for completion marker in the output
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
  
  INITIAL_MESSAGE="The previous session ended. Please continue working on GitHub Project #${PROJECT_NUMBER}. Check the status again and pick up the next item. If finished, output PROJECT COMPLETE."
done
