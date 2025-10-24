#!/bin/bash

# Setup GitHub Project v2 Fields and Options
# This script creates all custom fields with their options

set -e

PROJECT_ID="PVT_kwDOBW_6Ns4BGTch"

echo "🚀 Setting up GitHub Project fields and options..."
echo ""

# Helper function to run GraphQL
run_graphql() {
  gh api graphql -f query="$1"
}

# 1. Create Status field with options
echo "📊 Creating Status field..."
STATUS_RESULT=$(run_graphql 'mutation {
  createProjectV2Field(input: {
    projectId: "'"$PROJECT_ID"'"
    dataType: SINGLE_SELECT
    name: "Status"
    singleSelectOptions: [
      {name: "Todo", color: GRAY, description: "Work not yet started"}
      {name: "Ready", color: GREEN, description: "Ready to be picked up"}
      {name: "In Progress", color: YELLOW, description: "Currently being worked on"}
      {name: "In Review", color: BLUE, description: "PR created, awaiting review"}
      {name: "Blocked", color: RED, description: "Blocked by dependencies or issues"}
      {name: "Done", color: PURPLE, description: "Work completed and merged"}
    ]
  }) {
    projectV2Field {
      ... on ProjectV2SingleSelectField {
        id
        name
      }
    }
  }
}')
echo "✓ Status field created"
echo ""

# 2. Create Priority field with options
echo "📊 Creating Priority field..."
PRIORITY_RESULT=$(run_graphql 'mutation {
  createProjectV2Field(input: {
    projectId: "'"$PROJECT_ID"'"
    dataType: SINGLE_SELECT
    name: "Priority"
    singleSelectOptions: [
      {name: "Critical", color: RED, description: "Urgent, blocks other work"}
      {name: "High", color: ORANGE, description: "Important, should be done soon"}
      {name: "Medium", color: YELLOW, description: "Normal priority"}
      {name: "Low", color: GRAY, description: "Nice to have, can wait"}
    ]
  }) {
    projectV2Field {
      ... on ProjectV2SingleSelectField {
        id
        name
      }
    }
  }
}')
echo "✓ Priority field created"
echo ""

# 3. Create Size field with options
echo "📊 Creating Size field..."
SIZE_RESULT=$(run_graphql 'mutation {
  createProjectV2Field(input: {
    projectId: "'"$PROJECT_ID"'"
    dataType: SINGLE_SELECT
    name: "Size"
    singleSelectOptions: [
      {name: "XS", color: GRAY, description: "1-2 hours"}
      {name: "S", color: BLUE, description: "2-4 hours"}
      {name: "M", color: YELLOW, description: "4-8 hours"}
      {name: "L", color: ORANGE, description: "1-3 days"}
      {name: "XL", color: RED, description: "3+ days"}
    ]
  }) {
    projectV2Field {
      ... on ProjectV2SingleSelectField {
        id
        name
      }
    }
  }
}')
echo "✓ Size field created"
echo ""

# 4. Create Type field with options
echo "📊 Creating Type field..."
TYPE_RESULT=$(run_graphql 'mutation {
  createProjectV2Field(input: {
    projectId: "'"$PROJECT_ID"'"
    dataType: SINGLE_SELECT
    name: "Type"
    singleSelectOptions: [
      {name: "Epic", color: PURPLE, description: "Large feature tracking multiple sub-tasks"}
      {name: "Feature", color: BLUE, description: "New functionality or enhancement"}
      {name: "Bug", color: RED, description: "Something is broken"}
      {name: "Chore", color: GRAY, description: "Maintenance work"}
      {name: "Docs", color: GREEN, description: "Documentation"}
      {name: "Refactor", color: YELLOW, description: "Code improvement"}
    ]
  }) {
    projectV2Field {
      ... on ProjectV2SingleSelectField {
        id
        name
      }
    }
  }
}')
echo "✓ Type field created"
echo ""

# 5. Create Area field with options
echo "📊 Creating Area field..."
AREA_RESULT=$(run_graphql 'mutation {
  createProjectV2Field(input: {
    projectId: "'"$PROJECT_ID"'"
    dataType: SINGLE_SELECT
    name: "Area"
    singleSelectOptions: [
      {name: "Core", color: PURPLE, description: "Core orchestration and workflow"}
      {name: "CLI", color: BLUE, description: "Command-line interface"}
      {name: "GitHub API", color: GREEN, description: "GitHub API integration"}
      {name: "Projects", color: YELLOW, description: "GitHub Projects v2 integration"}
      {name: "Evaluation", color: ORANGE, description: "Issue evaluation and prioritization"}
      {name: "Testing", color: GRAY, description: "Test infrastructure"}
      {name: "Documentation", color: PINK, description: "Documentation and guides"}
    ]
  }) {
    projectV2Field {
      ... on ProjectV2SingleSelectField {
        id
        name
      }
    }
  }
}')
echo "✓ Area field created"
echo ""

# 6. Create Sprint (Iteration) field
echo "📊 Creating Sprint field..."
# Calculate dates for sprints (2 weeks each)
TODAY=$(date +%Y-%m-%d)
SPRINT_RESULT=$(run_graphql 'mutation {
  createProjectV2Field(input: {
    projectId: "'"$PROJECT_ID"'"
    dataType: ITERATION
    name: "Sprint"
    iterationConfiguration: {
      duration: 14
      startDay: 1
    }
  }) {
    projectV2Field {
      ... on ProjectV2IterationField {
        id
        name
        configuration {
          duration
          startDay
        }
      }
    }
  }
}')
echo "✓ Sprint field created (2-week iterations starting Monday)"
echo ""

# 7. Create Blocked By field (Text)
echo "📊 Creating Blocked By field..."
BLOCKED_RESULT=$(run_graphql 'mutation {
  createProjectV2Field(input: {
    projectId: "'"$PROJECT_ID"'"
    dataType: TEXT
    name: "Blocked By"
  }) {
    projectV2Field {
      ... on ProjectV2Field {
        id
        name
      }
    }
  }
}')
echo "✓ Blocked By field created"
echo ""

# 8. Create Effort Estimate field (Number)
echo "📊 Creating Effort Estimate field..."
EFFORT_RESULT=$(run_graphql 'mutation {
  createProjectV2Field(input: {
    projectId: "'"$PROJECT_ID"'"
    dataType: NUMBER
    name: "Effort Estimate"
  }) {
    projectV2Field {
      ... on ProjectV2Field {
        id
        name
      }
    }
  }
}')
echo "✓ Effort Estimate field created"
echo ""

echo "✅ All project fields created successfully!"
echo ""
echo "📋 Fields created:"
echo "  • Status (Single Select): Todo, Ready, In Progress, In Review, Blocked, Done"
echo "  • Priority (Single Select): Critical, High, Medium, Low"
echo "  • Size (Single Select): XS, S, M, L, XL"
echo "  • Type (Single Select): Epic, Feature, Bug, Chore, Docs, Refactor"
echo "  • Area (Single Select): Core, CLI, GitHub API, Projects, Evaluation, Testing, Documentation"
echo "  • Sprint (Iteration): 2-week sprints starting Monday"
echo "  • Blocked By (Text)"
echo "  • Effort Estimate (Number)"
echo ""
echo "🎯 Next step: Run ./set-issue-metadata.sh to apply metadata to all issues"
