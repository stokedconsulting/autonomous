#!/bin/bash
# Check the status of a Claude instance using hook files

INSTANCE_ID="${1}"
AUTONOMOUS_DIR="${2:-.autonomous}"

if [ -z "$INSTANCE_ID" ]; then
    echo "Usage: $0 <instance-id> [autonomous-dir]"
    echo "Example: $0 claude-b9b8b887 /path/to/project/.autonomous"
    exit 1
fi

echo "=== Instance Status Check: $INSTANCE_ID ==="
echo ""

# Check session file
SESSION_FILE="$AUTONOMOUS_DIR/session-$INSTANCE_ID.json"
if [ -f "$SESSION_FILE" ]; then
    echo "✓ Session completed (session file exists)"
    echo "  File: $SESSION_FILE"
    echo "  Contents:"
    cat "$SESSION_FILE" | jq '.' 2>/dev/null || cat "$SESSION_FILE"
    echo ""
else
    echo "• No session file (still running or crashed)"
    echo "  Expected: $SESSION_FILE"
    echo ""
fi

# Check activity log
ACTIVITY_FILE="$AUTONOMOUS_DIR/activity-$INSTANCE_ID.log"
if [ -f "$ACTIVITY_FILE" ]; then
    LINE_COUNT=$(wc -l < "$ACTIVITY_FILE")
    echo "✓ Activity log exists ($LINE_COUNT tool uses)"
    echo "  File: $ACTIVITY_FILE"
    echo "  Last 5 activities:"
    tail -5 "$ACTIVITY_FILE" | sed 's/^/    /'
    echo ""

    # Get last activity timestamp
    LAST_ACTIVITY=$(tail -1 "$ACTIVITY_FILE" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z')
    if [ -n "$LAST_ACTIVITY" ]; then
        echo "  Last activity: $LAST_ACTIVITY"

        # Calculate minutes ago (macOS compatible)
        LAST_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$LAST_ACTIVITY" +%s 2>/dev/null)
        NOW_EPOCH=$(date +%s)
        if [ -n "$LAST_EPOCH" ]; then
            MINUTES_AGO=$(( ($NOW_EPOCH - $LAST_EPOCH) / 60 ))
            echo "  Time since: ${MINUTES_AGO}m ago"
        fi
    fi
    echo ""
else
    echo "• No activity log (no tools used yet or wrong instance ID)"
    echo "  Expected: $ACTIVITY_FILE"
    echo ""
fi

# Check log file
LOG_FILE="$AUTONOMOUS_DIR/output-$INSTANCE_ID.log"
if [ -f "$LOG_FILE" ]; then
    SIZE=$(wc -c < "$LOG_FILE")
    LINES=$(wc -l < "$LOG_FILE")
    echo "✓ Output log exists (${SIZE} bytes, ${LINES} lines)"
    echo "  File: $LOG_FILE"
    echo ""
else
    echo "• No output log"
    echo "  Expected: $LOG_FILE"
    echo ""
fi

# Summary
echo "=== Summary ==="
if [ -f "$SESSION_FILE" ]; then
    echo "Status: COMPLETED (session ended normally)"
elif [ -f "$ACTIVITY_FILE" ]; then
    echo "Status: WORKING (tools being used)"
else
    echo "Status: UNKNOWN (no hook files - either just started, crashed, or wrong ID)"
fi
