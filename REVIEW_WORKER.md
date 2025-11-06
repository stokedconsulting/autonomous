# Review Worker Documentation

## Overview

The Review Worker is a standalone code review system that uses multi-persona AI evaluation to assess code quality. Unlike the merge worker's automatic review, this can be run manually or configured to review specific statuses with custom pass/fail actions.

## Features

✅ **Multi-Persona Review** - Same 4 expert personas as merge worker
✅ **Flexible Invocation** - Review by status or specific issue
✅ **Custom Actions** - Set pass/fail statuses or just review
✅ **Branch Selection** - Review any branch (feature, main, etc.)
✅ **GitHub Integration** - Posts detailed feedback as comments
✅ **Batch Processing** - Review multiple assignments at once

## Command Syntax

### 1. Review by Status (Batch Mode)

```bash
auto review --pass "Dev Complete" --fail "Failed Review"
```

**What it does:**
- Finds all assignments with status "In Review" (default)
- Reviews each one with 4 personas
- Processes 3 reviews concurrently (configurable)
- If PASS: Sets status to "Dev Complete"
- If FAIL: Sets status to "Failed Review" + posts detailed feedback

**Options:**
```bash
auto review \
  --status "In Review" \         # Status to filter (default: "In Review")
  --pass "Dev Complete" \         # Status on pass
  --fail "Failed Review" \        # Status on fail
  --branch main \                 # Review specific branch (optional)
  --max-concurrent 5 \            # Max concurrent reviews (default: 3)
  -v                             # Verbose output
```

**Concurrency Control:**
- Default: 3 reviews run at a time
- Can be configured in `.autonomous-config.json` under `reviewWorker.maxConcurrent`
- Can be overridden via CLI with `--max-concurrent`
- Reviews are processed in batches to avoid overwhelming the system

### 2. Review Specific Issue

```bash
auto item review 193
```

**What it does:**
- Reviews issue #193's code changes
- Uses the assignment's branch by default
- Posts results to GitHub
- Does NOT change status (no --pass/--fail)

**With custom branch:**
```bash
auto item review 193 --branch main
```

**What it does:**
- Reviews issue #193
- Checks if the work is implemented in `main` branch
- Validates the issue is complete on main
- Posts results but doesn't change status

**With pass/fail actions:**
```bash
auto item review 193 \
  --pass "Dev Complete" \
  --fail "Failed Review"
```

## Use Cases

### Use Case 1: Validate PR Before Merge

You have issues in "In Review" status and want to validate they're ready:

```bash
# Review all "In Review" items
# Pass → "Dev Complete" (ready for merge worker)
# Fail → "Failed Review" (needs fixes)
auto review --pass "Dev Complete" --fail "Failed Review"
```

### Use Case 2: Verify Work is on Main

Check if issue #193's work actually made it to main:

```bash
# Review against main branch
# No status changes, just verification
auto item review 193 --branch main
```

Check the GitHub comment for results.

### Use Case 3: Re-Review After Fixes

An issue failed review, developer fixed it, re-check:

```bash
auto item review 193 --pass "Dev Complete"
```

### Use Case 4: Quality Gate for Different Stages

Review "Dev Complete" items before allowing merge worker:

```bash
auto review --status "Dev Complete" --pass "Ready for Stage" --fail "Failed QA"
```

## The 4 Personas

Each review runs through 4 expert personas:

### 1. Product Manager
**Focus:**
- Requirements coverage
- User value delivery
- Acceptance criteria
- Feature completeness

**Passes if:**
- All requirements from issue addressed
- Solution solves stated problem
- No scope creep

### 2. Senior Software Engineer
**Focus:**
- Code quality
- Architecture
- Maintainability
- Best practices

**Passes if:**
- Follows project conventions
- No obvious bugs
- Proper error handling
- Readable and well-structured

### 3. QA Engineer
**Focus:**
- Test coverage
- Edge cases
- Error scenarios
- Regression risk

**Passes if:**
- Critical paths tested
- Edge cases handled
- Error scenarios covered

### 4. Security Engineer
**Focus:**
- Security vulnerabilities
- Data validation
- Authentication/Authorization
- Sensitive data handling

**Passes if:**
- No security vulnerabilities
- Input validated
- No hardcoded secrets
- Proper access control

## GitHub Comments

### On Success

```markdown
## ✅ Code Review: PASSED

All persona reviews passed successfully!

**Review Summary:**
- **Status:** PASSED
- **Reviewers:** 4 personas
- **Result:** All criteria met

---
*Automated by Review Worker*
```

### On Failure

```markdown
## ❌ Code Review: FAILED

The code changes did not pass all persona reviews. Please address the issues below:

### Product Manager Review: ❌ FAILED

The implementation does not fully address requirement #3 from the original issue.
The user authentication flow is missing the "remember me" functionality that
was explicitly requested.

**Score:** 6/10

### QA Engineer Review: ❌ FAILED

Missing test coverage for the error handling paths. Specifically:
- No tests for invalid token scenarios
- No tests for session expiration
- Edge case: empty username not tested

**Score:** 5/10

---

**Review Summary:**
- **Status:** FAILED
- **Passed:** 2/4
- **Failed:** 2/4

**Passed Reviews:**
- senior engineer
- security engineer

**What to do next:**
1. Read the feedback from each failed review above
2. Make the necessary changes to address the concerns
3. Update your branch with the fixes
4. The review will run again automatically (or request a re-review)

---
*Automated by Review Worker*
```

## Integration with Workflow

### Scenario A: Pre-Merge Review Gate

```bash
# In .github/workflows/review.yml or manually
auto review --pass "Dev Complete" --fail "Failed Review"
```

This ensures all "In Review" items pass quality checks before merge worker picks them up.

### Scenario B: Post-Merge Verification

After something is merged to main, verify the original issue is satisfied:

```bash
auto item review 193 --branch main
```

Check if issue #193's requirements are met on main.

### Scenario C: Custom Status Flow

```bash
# Review items in custom status
auto review \
  --status "QA Ready" \
  --pass "QA Passed" \
  --fail "QA Failed"
```

## Configuration

The review worker can be configured in `.autonomous-config.json`:

```json
{
  "reviewWorker": {
    "maxConcurrent": 3,
    "claudePath": "/path/to/claude"
  }
}
```

**Configuration Options:**
- `maxConcurrent` - Max concurrent reviews (default: 3)
- `claudePath` - Path to Claude CLI (default: from `llms.claude.cliPath`)

**Defaults:**
- If no `reviewWorker` config exists, defaults to 3 concurrent reviews
- Uses `llms.claude.cliPath` if no `claudePath` specified
- GitHub token from main config
- Same 4 personas as merge worker

To customize personas, you'd extend the `ReviewWorker` class (future enhancement).

## Examples

### Example 1: Your Use Case

> "validate that the code specified in the issue has been implemented to a satisfactory level"

```bash
# Review all items currently "In Review"
# If they pass → "Dev Complete"
# If they fail → "Failed Review" with detailed feedback
auto review --pass "Dev Complete" --fail "Failed Review"
```

Each issue gets:
- ✅ Pass: Status updated, simple "passed review" comment
- ❌ Fail: Status updated, detailed feedback on what to fix

### Example 2: Verify on Main

> "verify that the work specified in the itemId is implemented in the main branch"

```bash
# Check if issue #193 is complete on main
auto item review 193 --branch main
```

Posts a comment with review results but doesn't change status.

### Example 3: Custom Workflow

```bash
# Review "Staging" status items
# Pass → "Production Ready"
# Fail → "Staging Failed"
auto review \
  --status "Staging" \
  --pass "Production Ready" \
  --fail "Staging Failed"
```

### Example 4: High Concurrency

If you have many items to review and want to process them faster:

```bash
# Review with 10 concurrent workers
auto review \
  --pass "Dev Complete" \
  --fail "Failed Review" \
  --max-concurrent 10
```

**Note:** Higher concurrency means faster processing but more system resources. Adjust based on your machine's capabilities.

## Differences from Merge Worker

| Feature | Review Worker | Merge Worker |
|---------|--------------|--------------|
| **Trigger** | Manual CLI command | Automatic (every 60s) |
| **Purpose** | Validate code quality | Merge + validate + deploy |
| **Actions** | Optional status changes | Always updates status |
| **Branch** | Any branch | merge_stage only |
| **Merging** | No merging | Merges to merge_stage |
| **Conflicts** | N/A | Resolves automatically |
| **Stage Deploy** | No | Yes (force push) |
| **Use Case** | Quality gates, verification | Automated integration |

## Technical Details

### How Branch Review Works

```typescript
// Gets diff between main and specified branch
git diff origin/main..origin/[branch]

// Then reviews that diff with personas
```

### Status Mapping

The worker maps common GitHub Project statuses to internal statuses:

```typescript
'Dev Complete' → 'dev-complete'
'In Review' → 'dev-complete'
'Failed Review' → 'assigned'
'Todo' → 'assigned'
'In Progress' → 'in-progress'
```

### Review Results Storage

Results are NOT stored in the assignment (unlike merge worker). They're only posted as GitHub comments. This is intentional - review worker is meant for ad-hoc checks.

## Troubleshooting

### "No assignments found"

The status filter didn't match any assignments. Check:
```bash
auto status  # See what statuses exist
```

### "No changes found on branch"

The branch has no diff compared to main. Either:
- Branch is already merged
- Branch doesn't exist
- Wrong branch name

### Reviews always fail

Check persona feedback in GitHub comments. Common issues:
- Missing tests
- Incomplete requirements
- Code quality issues

### Comment not posted

Check GitHub token has permissions:
- `repo` scope for private repos
- `public_repo` for public repos

## Advanced Usage

### Pipe to JSON

```bash
# Future: Add JSON output for scripting
auto review --pass "Ready" --fail "Not Ready" --json > results.json
```

### Custom Status Flows

```bash
# Stage 1: Dev review
auto review --status "Dev Done" --pass "QA Ready" --fail "Dev Failed"

# Stage 2: QA review
auto review --status "QA Ready" --pass "Stage Ready" --fail "QA Failed"

# Stage 3: Staging review
auto review --status "Stage Ready" --pass "Prod Ready" --fail "Stage Failed"
```

## Summary

The Review Worker provides flexible, on-demand code quality validation using the same multi-persona system as the merge worker, but with full control over when, what, and how to review.

**Key Commands:**
- `auto review --pass "X" --fail "Y"` - Batch review with actions
- `auto item review <num>` - Single item review (no actions)
- `auto item review <num> --branch main` - Verify on specific branch

All reviews post detailed feedback to GitHub issues.
