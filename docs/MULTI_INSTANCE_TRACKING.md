# Multi-Instance LLM Tracking

This guide explains how to track multiple LLM instances working on different issues simultaneously using GitHub Projects v2.

## Overview

When running multiple concurrent LLM instances (e.g., `maxConcurrentIssues: 3`), the autonomous system uses **slot-based naming** to track which instance is working on which issue:

- `claude-1`, `claude-2`, `claude-3` (for Claude instances)
- `gemini-1`, `gemini-2` (for Gemini instances)
- `codex-1`, `codex-2` (for Codex instances)

This allows you to:
- ✅ Distinguish between multiple instances of the same LLM provider
- ✅ See at a glance which slot is handling which issue
- ✅ Track work across multiple concurrent instances
- ✅ Identify abandoned work when instances are killed

## Setup

### 1. Create the "Assigned Instance" Field in GitHub Projects

1. Open your GitHub Project board
2. Click the **"+"** button to add a new field
3. Configure:
   - **Field name**: `Assigned Instance` (or your preferred name)
   - **Field type**: **TEXT** (recommended) or **SINGLE_SELECT**
     - TEXT: Automatically handles any instance name
     - SINGLE_SELECT: Requires pre-defining options (e.g., claude-1, claude-2, etc.)

### 2. Configure in `.autonomous-config.json`

Add the field configuration to your project settings:

```json
{
  "project": {
    "enabled": true,
    "fields": {
      "status": { ... },
      "priority": { ... },
      "assignedInstance": {
        "fieldName": "Assigned Instance"
      }
    }
  }
}
```

### 3. Set `maxConcurrentIssues` Per LLM

Configure how many concurrent instances you want per LLM provider:

```json
{
  "llms": {
    "claude": {
      "enabled": true,
      "maxConcurrentIssues": 3  // Allows claude-1, claude-2, claude-3
    },
    "gemini": {
      "enabled": true,
      "maxConcurrentIssues": 2  // Allows gemini-1, gemini-2
    }
  }
}
```

## How It Works

### Assignment Flow

1. **User runs**: `auto assign 123`
2. **System checks**: Available slots for the LLM provider
3. **System assigns**: Next available slot (e.g., `claude-1`)
4. **System updates**:
   - Local assignment record with `llmInstanceId: "claude-1"`
   - GitHub Project field "Assigned Instance" = `"claude-1"`
   - Status field = `"In Progress"`

### Instance Lifecycle

**When an instance starts:**
```
Issue #123 → claude-1 (Status: In Progress, Assigned Instance: claude-1)
Issue #456 → claude-2 (Status: In Progress, Assigned Instance: claude-2)
```

**When an instance completes:**
```
Issue #123 → Status: Done, Assigned Instance: (cleared)
```

**When an instance is killed:**
```
Issue #123 → Status: In Progress, Assigned Instance: claude-1 (abandoned)
```

### Abandoned Work Detection

If you kill an instance (e.g., Ctrl+C), the assignment remains in `"in-progress"` state but the process is no longer running.

**On next startup**, the orchestrator can detect abandoned work and:
- Resume the work with the same slot ID
- Mark as failed and free the slot
- Prompt the user for what to do

## Benefits

### Without Assigned Instance Field
You only see:
- Issue #123: Status = "In Progress"
- Issue #456: Status = "In Progress"

❌ No way to tell which instance is working on which issue

### With Assigned Instance Field
You see:
- Issue #123: Status = "In Progress", Assigned Instance = "claude-1"
- Issue #456: Status = "In Progress", Assigned Instance = "claude-2"

✅ Clear tracking of which instance is working on what
✅ Easy filtering and grouping in project board
✅ Better visibility into instance utilization

## Filtering in GitHub Projects

You can now filter your project board by assigned instance:

- **View all work by `claude-1`**: Filter where `Assigned Instance = "claude-1"`
- **View all active instances**: Filter where `Assigned Instance is not empty`
- **View available capacity**: Count of `Assigned Instance is empty` + `Status = Ready`

## Example Configuration

Full example from `.autonomous-config.json`:

```json
{
  "version": "1.0.0",
  "llms": {
    "claude": {
      "enabled": true,
      "maxConcurrentIssues": 2,
      "cliPath": "claude"
    }
  },
  "project": {
    "enabled": true,
    "projectNumber": 5,
    "organizationProject": true,
    "fields": {
      "status": {
        "fieldName": "Status",
        "readyValues": ["Ready", "Todo"],
        "inProgressValue": "In Progress",
        "reviewValue": "In Review",
        "doneValue": "Done",
        "blockedValue": "Blocked"
      },
      "assignedInstance": {
        "fieldName": "Assigned Instance"
      }
    }
  }
}
```

## Cost Considerations

**Why not use GitHub assignees?**

GitHub issue assignees only support individual user accounts, not teams. Adding bot accounts as organization members would count as paid seats.

**The custom field approach:**
- ✅ No additional cost
- ✅ Unlimited instances
- ✅ More flexible than assignees
- ✅ Still provides clear visibility

## Troubleshooting

### "Assigned Instance" field not updating

1. Check field name matches configuration exactly (case-sensitive)
2. Verify field type is TEXT or SINGLE_SELECT
3. Check that project integration is enabled
4. Run `auto project status --verbose` to see field details

### No available slots

```
✗ No available Claude instances (max: 1)
Try increasing maxConcurrentIssues in .autonomous-config.json
```

**Solution**: Increase `maxConcurrentIssues` or wait for an instance to complete.

### Slot stuck "in use"

If an instance was killed ungracefully, the slot may appear in use.

**Future enhancement**: Abandoned work detection will auto-cleanup or prompt for resumption.

## Next Steps

- [ ] Implement abandoned work detection on startup
- [ ] Add `autonomous instances` command to show slot utilization
- [ ] Auto-clear assigned instance field on completion
- [ ] Support for manual instance ID override

## Related Documentation

- [GitHub Projects Phase 4-5 Implementation](./PHASE_4_5_IMPLEMENTATION.md)
- [Project Configuration](../README.md#project-configuration)
