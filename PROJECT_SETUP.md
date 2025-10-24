# GitHub Project Setup Guide

## 📊 Project Information

- **Project Name**: Autonomous Development
- **Project Number**: 5
- **Project URL**: https://github.com/orgs/stokedconsulting/projects/5
- **Project ID**: `PVT_kwDOBW_6Ns4BGTch`

## ✅ Completed Steps

1. ✅ Created GitHub Project v2
2. ✅ Added all 15 issues to the project (#1-15)

## 🔧 Required Manual Setup (In GitHub UI)

Since GitHub Projects v2 field options cannot be easily created via API, you need to manually configure the following fields in the project UI:

### 1. Create Custom Fields

Visit https://github.com/orgs/stokedconsulting/projects/5/settings/fields and add these fields:

#### Status (Single Select) - Already exists
**Options to add:**
- Todo
- Ready
- In Progress
- In Review
- Blocked
- Done

#### Priority (Single Select)
**Options:**
- 🔴 Critical
- 🟠 High
- 🟡 Medium
- 🟢 Low

#### Size (Single Select)
**Options:**
- XS (1-2 hours)
- S (2-4 hours)
- M (4-8 hours)
- L (1-3 days)
- XL (3+ days)

#### Type (Single Select)
**Options:**
- Epic
- Feature
- Bug
- Chore
- Docs
- Refactor

#### Area (Single Select)
**Options:**
- Core
- CLI
- GitHub API
- Projects
- Evaluation
- Testing
- Documentation

#### Sprint (Iteration Field)
**Configuration:**
- Duration: 2 weeks
- Start day: Monday
- Create iterations:
  - Sprint 1
  - Sprint 2
  - Sprint 3
  - Sprint 4

#### Blocked By (Text)
- Simple text field for issue numbers (e.g., "#1, #2")

#### Effort Estimate (Number)
- Number field for hours

### 2. Apply Metadata to Issues

Use the metadata guide in `scripts/update-issue-metadata.md` to set:

**Phase 1 Issues (#1-8):**
- Status: Ready
- Priority: High (except #7, #8 = Medium)
- Sprint: Sprint 1
- Type: Epic (#1), Feature (rest)
- Size: As specified in metadata guide

**Phase 2-5 Issues (#9-14):**
- Status: Todo
- Blocked By: #1 (and others as specified)
- Sprint: Sprint 2 or 3
- Set other fields per metadata guide

**Tracking Issue (#15):**
- Status: In Progress
- Priority: Critical

### 3. Configure Project Views

Create these saved views:

#### Current Sprint
- Filter: Sprint = "Sprint 1"
- Group by: Status
- Sort by: Priority

#### Ready to Work
- Filter: Status = "Ready" OR Status = "Todo"
- Filter: Blocked By is empty
- Sort by: Priority, then Size

#### All Phases
- Group by: Epic (parent issue)
- Sort by: Issue number

#### Blocked Items
- Filter: Status = "Blocked" OR Blocked By is not empty
- Sort by: Priority

## 🚀 Integration with Autonomous

Once fields are configured, add this to `.autonomous-config.json`:

```json
{
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
      "priority": {
        "fieldName": "Priority",
        "values": {
          "critical": { "weight": 10 },
          "high": { "weight": 7 },
          "medium": { "weight": 4 },
          "low": { "weight": 1 }
        }
      },
      "size": {
        "fieldName": "Size",
        "values": ["XS", "S", "M", "L", "XL"]
      },
      "iteration": {
        "fieldName": "Sprint",
        "workInCurrentOnly": true
      },
      "blockedBy": {
        "fieldName": "Blocked By",
        "checkBeforeAssign": true
      }
    },
    "prioritization": {
      "weights": {
        "projectPriority": 0.5,
        "aiEvaluation": 0.3,
        "sprintBoost": 0.1,
        "sizePreference": 0.1
      }
    },
    "automation": {
      "autoUpdateStatus": true,
      "autoLinkPRs": true,
      "autoMarkDone": true
    }
  }
}
```

Then run:
```bash
auto project init
```

## 📋 Current Sprint 1 Tasks

All Phase 1 tasks are in Sprint 1 and ready to work on:

1. #2 - Implement GitHubProjectsAPI (8h)
2. #3 - Add project field mapping (6h)
3. #4 - Implement project items query (8h)
4. #5 - Add project configuration (4h)
5. #6 - Create 'project init' command (6h)
6. #7 - Create 'project status' command (4h)
7. #8 - Create 'project list-ready' command (4h)

**Total Sprint 1 Estimate**: 40 hours

## 🎯 Quick Start

Once setup is complete, autonomous will:

1. Only pick up "Ready" or "Todo" items from current sprint
2. Skip items with "Blocked By" values
3. Prioritize based on hybrid score (AI + Project metadata)
4. Auto-update Status as work progresses
5. Auto-link PRs to project items

Start working:
```bash
cd /Users/stoked/work/anonomous/autonomous
auto start
```

This will automatically select the highest-priority ready task from Sprint 1!
