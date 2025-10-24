#!/bin/bash

# Set Issue Metadata for Autonomous Development Project
# This script configures all 15 issues with proper metadata

set -e

PROJECT_ID="PVT_kwDOBW_6Ns4BGTch"
REPO_OWNER="stokedconsulting"
REPO_NAME="autonomous"

echo "🚀 Setting up issue metadata for Autonomous Development Project..."
echo ""

# Helper function to run GraphQL
run_graphql() {
  gh api graphql -f query="$1" --jq "$2"
}

# Get all field IDs and option IDs
echo "📊 Fetching field and option IDs..."

FIELD_DATA=$(gh api graphql -f query='
query {
  node(id: "'"$PROJECT_ID"'") {
    ... on ProjectV2 {
      fields(first: 20) {
        nodes {
          ... on ProjectV2Field {
            id
            name
          }
          ... on ProjectV2SingleSelectField {
            id
            name
            options {
              id
              name
            }
          }
          ... on ProjectV2IterationField {
            id
            name
            configuration {
              iterations {
                id
                title
              }
            }
          }
        }
      }
    }
  }
}')

# Extract field IDs
STATUS_FIELD_ID=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Status") | .id')
PRIORITY_FIELD_ID=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Priority") | .id')
SIZE_FIELD_ID=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Size") | .id')
TYPE_FIELD_ID=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Issue Type") | .id')
AREA_FIELD_ID=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Area") | .id')
SPRINT_FIELD_ID=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Sprint") | .id')
BLOCKED_FIELD_ID=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Blocked By") | .id')
EFFORT_FIELD_ID=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Effort Estimate") | .id')

# Extract option IDs for Status
STATUS_TODO=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Status") | .options[] | select(.name == "Todo") | .id')
STATUS_READY=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Status") | .options[] | select(.name == "Ready") | .id')
STATUS_IN_PROGRESS=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Status") | .options[] | select(.name == "In Progress") | .id')

# Extract option IDs for Priority
PRIORITY_CRITICAL=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Priority") | .options[] | select(.name == "Critical") | .id')
PRIORITY_HIGH=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Priority") | .options[] | select(.name == "High") | .id')
PRIORITY_MEDIUM=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Priority") | .options[] | select(.name == "Medium") | .id')

# Extract option IDs for Size
SIZE_XS=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Size") | .options[] | select(.name == "XS") | .id')
SIZE_S=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Size") | .options[] | select(.name == "S") | .id')
SIZE_M=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Size") | .options[] | select(.name == "M") | .id')
SIZE_L=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Size") | .options[] | select(.name == "L") | .id')
SIZE_XL=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Size") | .options[] | select(.name == "XL") | .id')

# Extract option IDs for Issue Type
TYPE_EPIC=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Issue Type") | .options[] | select(.name == "Epic") | .id')
TYPE_FEATURE=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Issue Type") | .options[] | select(.name == "Feature") | .id')

# Extract option IDs for Area
AREA_PROJECTS=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Area") | .options[] | select(.name == "Projects") | .id')
AREA_CORE=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Area") | .options[] | select(.name == "Core") | .id')
AREA_CLI=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Area") | .options[] | select(.name == "CLI") | .id')
AREA_GITHUB_API=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Area") | .options[] | select(.name == "GitHub API") | .id')
AREA_EVALUATION=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Area") | .options[] | select(.name == "Evaluation") | .id')

# Extract Sprint iteration IDs (may be empty if not configured)
SPRINT_1=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Sprint") | .configuration.iterations[]? | select(.title == "Sprint 1") | .id // empty')
SPRINT_2=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Sprint") | .configuration.iterations[]? | select(.title == "Sprint 2") | .id // empty')
SPRINT_3=$(echo "$FIELD_DATA" | jq -r '.data.node.fields.nodes[] | select(.name == "Sprint") | .configuration.iterations[]? | select(.title == "Sprint 3") | .id // empty')

echo "✓ Field IDs loaded"
echo ""

# Function to get project item ID for an issue
get_project_item_id() {
  local issue_number=$1
  gh api graphql -f query='
  query {
    repository(owner: "'"$REPO_OWNER"'", name: "'"$REPO_NAME"'") {
      issue(number: '"$issue_number"') {
        projectItems(first: 10) {
          nodes {
            id
            project {
              id
            }
          }
        }
      }
    }
  }' --jq '.data.repository.issue.projectItems.nodes[] | select(.project.id == "'"$PROJECT_ID"'") | .id'
}

# Function to update a single-select field
update_single_select() {
  local item_id=$1
  local field_id=$2
  local option_id=$3

  gh api graphql -f query='
  mutation {
    updateProjectV2ItemFieldValue(input: {
      projectId: "'"$PROJECT_ID"'"
      itemId: "'"$item_id"'"
      fieldId: "'"$field_id"'"
      value: {
        singleSelectOptionId: "'"$option_id"'"
      }
    }) {
      projectV2Item {
        id
      }
    }
  }' > /dev/null
}

# Function to update a text field
update_text() {
  local item_id=$1
  local field_id=$2
  local text_value=$3

  gh api graphql -f query='
  mutation {
    updateProjectV2ItemFieldValue(input: {
      projectId: "'"$PROJECT_ID"'"
      itemId: "'"$item_id"'"
      fieldId: "'"$field_id"'"
      value: {
        text: "'"$text_value"'"
      }
    }) {
      projectV2Item {
        id
      }
    }
  }' > /dev/null
}

# Function to update a number field
update_number() {
  local item_id=$1
  local field_id=$2
  local number_value=$3

  gh api graphql -f query='
  mutation {
    updateProjectV2ItemFieldValue(input: {
      projectId: "'"$PROJECT_ID"'"
      itemId: "'"$item_id"'"
      fieldId: "'"$field_id"'"
      value: {
        number: '"$number_value"'
      }
    }) {
      projectV2Item {
        id
      }
    }
  }' > /dev/null
}

# Function to update an iteration field
update_iteration() {
  local item_id=$1
  local field_id=$2
  local iteration_id=$3

  # Skip if iteration_id is empty
  if [ -z "$iteration_id" ]; then
    return
  fi

  gh api graphql -f query='
  mutation {
    updateProjectV2ItemFieldValue(input: {
      projectId: "'"$PROJECT_ID"'"
      itemId: "'"$item_id"'"
      fieldId: "'"$field_id"'"
      value: {
        iterationId: "'"$iteration_id"'"
      }
    }) {
      projectV2Item {
        id
      }
    }
  }' > /dev/null
}

# Configure each issue
echo "📝 Configuring issues..."
echo ""

# Issue #1 - Epic Phase 1
echo "Setting metadata for #1 - [Epic] Phase 1..."
ITEM_1=$(get_project_item_id 1)
update_single_select "$ITEM_1" "$STATUS_FIELD_ID" "$STATUS_READY"
update_single_select "$ITEM_1" "$PRIORITY_FIELD_ID" "$PRIORITY_HIGH"
update_single_select "$ITEM_1" "$SIZE_FIELD_ID" "$SIZE_L"
update_single_select "$ITEM_1" "$TYPE_FIELD_ID" "$TYPE_EPIC"
update_single_select "$ITEM_1" "$AREA_FIELD_ID" "$AREA_PROJECTS"
update_iteration "$ITEM_1" "$SPRINT_FIELD_ID" "$SPRINT_1"
update_number "$ITEM_1" "$EFFORT_FIELD_ID" 40
echo "  ✓ #1 configured"

# Issue #2
echo "Setting metadata for #2 - Implement GitHubProjectsAPI..."
ITEM_2=$(get_project_item_id 2)
update_single_select "$ITEM_2" "$STATUS_FIELD_ID" "$STATUS_READY"
update_single_select "$ITEM_2" "$PRIORITY_FIELD_ID" "$PRIORITY_HIGH"
update_single_select "$ITEM_2" "$SIZE_FIELD_ID" "$SIZE_M"
update_single_select "$ITEM_2" "$TYPE_FIELD_ID" "$TYPE_FEATURE"
update_single_select "$ITEM_2" "$AREA_FIELD_ID" "$AREA_GITHUB_API"
update_iteration "$ITEM_2" "$SPRINT_FIELD_ID" "$SPRINT_1"
update_number "$ITEM_2" "$EFFORT_FIELD_ID" 8
echo "  ✓ #2 configured"

# Issue #3
echo "Setting metadata for #3 - Add project field mapping..."
ITEM_3=$(get_project_item_id 3)
update_single_select "$ITEM_3" "$STATUS_FIELD_ID" "$STATUS_READY"
update_single_select "$ITEM_3" "$PRIORITY_FIELD_ID" "$PRIORITY_HIGH"
update_single_select "$ITEM_3" "$SIZE_FIELD_ID" "$SIZE_M"
update_single_select "$ITEM_3" "$TYPE_FIELD_ID" "$TYPE_FEATURE"
update_single_select "$ITEM_3" "$AREA_FIELD_ID" "$AREA_PROJECTS"
update_iteration "$ITEM_3" "$SPRINT_FIELD_ID" "$SPRINT_1"
update_number "$ITEM_3" "$EFFORT_FIELD_ID" 6
echo "  ✓ #3 configured"

# Issue #4
echo "Setting metadata for #4 - Implement project items query..."
ITEM_4=$(get_project_item_id 4)
update_single_select "$ITEM_4" "$STATUS_FIELD_ID" "$STATUS_READY"
update_single_select "$ITEM_4" "$PRIORITY_FIELD_ID" "$PRIORITY_HIGH"
update_single_select "$ITEM_4" "$SIZE_FIELD_ID" "$SIZE_M"
update_single_select "$ITEM_4" "$TYPE_FIELD_ID" "$TYPE_FEATURE"
update_single_select "$ITEM_4" "$AREA_FIELD_ID" "$AREA_PROJECTS"
update_iteration "$ITEM_4" "$SPRINT_FIELD_ID" "$SPRINT_1"
update_number "$ITEM_4" "$EFFORT_FIELD_ID" 8
echo "  ✓ #4 configured"

# Issue #5
echo "Setting metadata for #5 - Add project configuration..."
ITEM_5=$(get_project_item_id 5)
update_single_select "$ITEM_5" "$STATUS_FIELD_ID" "$STATUS_READY"
update_single_select "$ITEM_5" "$PRIORITY_FIELD_ID" "$PRIORITY_HIGH"
update_single_select "$ITEM_5" "$SIZE_FIELD_ID" "$SIZE_S"
update_single_select "$ITEM_5" "$TYPE_FIELD_ID" "$TYPE_FEATURE"
update_single_select "$ITEM_5" "$AREA_FIELD_ID" "$AREA_CORE"
update_iteration "$ITEM_5" "$SPRINT_FIELD_ID" "$SPRINT_1"
update_number "$ITEM_5" "$EFFORT_FIELD_ID" 4
echo "  ✓ #5 configured"

# Issue #6
echo "Setting metadata for #6 - Create 'project init' command..."
ITEM_6=$(get_project_item_id 6)
update_single_select "$ITEM_6" "$STATUS_FIELD_ID" "$STATUS_READY"
update_single_select "$ITEM_6" "$PRIORITY_FIELD_ID" "$PRIORITY_HIGH"
update_single_select "$ITEM_6" "$SIZE_FIELD_ID" "$SIZE_M"
update_single_select "$ITEM_6" "$TYPE_FIELD_ID" "$TYPE_FEATURE"
update_single_select "$ITEM_6" "$AREA_FIELD_ID" "$AREA_CLI"
update_iteration "$ITEM_6" "$SPRINT_FIELD_ID" "$SPRINT_1"
update_number "$ITEM_6" "$EFFORT_FIELD_ID" 6
echo "  ✓ #6 configured"

# Issue #7
echo "Setting metadata for #7 - Create 'project status' command..."
ITEM_7=$(get_project_item_id 7)
update_single_select "$ITEM_7" "$STATUS_FIELD_ID" "$STATUS_READY"
update_single_select "$ITEM_7" "$PRIORITY_FIELD_ID" "$PRIORITY_MEDIUM"
update_single_select "$ITEM_7" "$SIZE_FIELD_ID" "$SIZE_S"
update_single_select "$ITEM_7" "$TYPE_FIELD_ID" "$TYPE_FEATURE"
update_single_select "$ITEM_7" "$AREA_FIELD_ID" "$AREA_CLI"
update_iteration "$ITEM_7" "$SPRINT_FIELD_ID" "$SPRINT_1"
update_number "$ITEM_7" "$EFFORT_FIELD_ID" 4
echo "  ✓ #7 configured"

# Issue #8
echo "Setting metadata for #8 - Create 'project list-ready' command..."
ITEM_8=$(get_project_item_id 8)
update_single_select "$ITEM_8" "$STATUS_FIELD_ID" "$STATUS_READY"
update_single_select "$ITEM_8" "$PRIORITY_FIELD_ID" "$PRIORITY_MEDIUM"
update_single_select "$ITEM_8" "$SIZE_FIELD_ID" "$SIZE_S"
update_single_select "$ITEM_8" "$TYPE_FIELD_ID" "$TYPE_FEATURE"
update_single_select "$ITEM_8" "$AREA_FIELD_ID" "$AREA_CLI"
update_iteration "$ITEM_8" "$SPRINT_FIELD_ID" "$SPRINT_1"
update_number "$ITEM_8" "$EFFORT_FIELD_ID" 4
echo "  ✓ #8 configured"

# Issue #9 - Epic Phase 2
echo "Setting metadata for #9 - [Epic] Phase 2..."
ITEM_9=$(get_project_item_id 9)
update_single_select "$ITEM_9" "$STATUS_FIELD_ID" "$STATUS_TODO"
update_single_select "$ITEM_9" "$PRIORITY_FIELD_ID" "$PRIORITY_HIGH"
update_single_select "$ITEM_9" "$SIZE_FIELD_ID" "$SIZE_M"
update_single_select "$ITEM_9" "$TYPE_FIELD_ID" "$TYPE_EPIC"
update_single_select "$ITEM_9" "$AREA_FIELD_ID" "$AREA_EVALUATION"
update_iteration "$ITEM_9" "$SPRINT_FIELD_ID" "$SPRINT_2"
update_text "$ITEM_9" "$BLOCKED_FIELD_ID" "#1"
update_number "$ITEM_9" "$EFFORT_FIELD_ID" 16
echo "  ✓ #9 configured"

# Issue #10 - Epic Phase 3
echo "Setting metadata for #10 - [Epic] Phase 3..."
ITEM_10=$(get_project_item_id 10)
update_single_select "$ITEM_10" "$STATUS_FIELD_ID" "$STATUS_TODO"
update_single_select "$ITEM_10" "$PRIORITY_FIELD_ID" "$PRIORITY_HIGH"
update_single_select "$ITEM_10" "$SIZE_FIELD_ID" "$SIZE_M"
update_single_select "$ITEM_10" "$TYPE_FIELD_ID" "$TYPE_EPIC"
update_single_select "$ITEM_10" "$AREA_FIELD_ID" "$AREA_PROJECTS"
update_iteration "$ITEM_10" "$SPRINT_FIELD_ID" "$SPRINT_2"
update_text "$ITEM_10" "$BLOCKED_FIELD_ID" "#1"
update_number "$ITEM_10" "$EFFORT_FIELD_ID" 16
echo "  ✓ #10 configured"

# Issue #11 - Epic Phase 4
echo "Setting metadata for #11 - [Epic] Phase 4..."
ITEM_11=$(get_project_item_id 11)
update_single_select "$ITEM_11" "$STATUS_FIELD_ID" "$STATUS_TODO"
update_single_select "$ITEM_11" "$PRIORITY_FIELD_ID" "$PRIORITY_MEDIUM"
update_single_select "$ITEM_11" "$SIZE_FIELD_ID" "$SIZE_M"
update_single_select "$ITEM_11" "$TYPE_FIELD_ID" "$TYPE_EPIC"
update_single_select "$ITEM_11" "$AREA_FIELD_ID" "$AREA_PROJECTS"
update_iteration "$ITEM_11" "$SPRINT_FIELD_ID" "$SPRINT_3"
update_text "$ITEM_11" "$BLOCKED_FIELD_ID" "#1, #10"
update_number "$ITEM_11" "$EFFORT_FIELD_ID" 16
echo "  ✓ #11 configured"

# Issue #12 - Epic Phase 5
echo "Setting metadata for #12 - [Epic] Phase 5..."
ITEM_12=$(get_project_item_id 12)
update_single_select "$ITEM_12" "$STATUS_FIELD_ID" "$STATUS_TODO"
update_single_select "$ITEM_12" "$PRIORITY_FIELD_ID" "$PRIORITY_MEDIUM"
update_single_select "$ITEM_12" "$SIZE_FIELD_ID" "$SIZE_M"
update_single_select "$ITEM_12" "$TYPE_FIELD_ID" "$TYPE_EPIC"
update_single_select "$ITEM_12" "$AREA_FIELD_ID" "$AREA_PROJECTS"
update_iteration "$ITEM_12" "$SPRINT_FIELD_ID" "$SPRINT_3"
update_text "$ITEM_12" "$BLOCKED_FIELD_ID" "#1, #10"
update_number "$ITEM_12" "$EFFORT_FIELD_ID" 16
echo "  ✓ #12 configured"

# Issue #13
echo "Setting metadata for #13 - Implement ProjectAwarePrioritizer..."
ITEM_13=$(get_project_item_id 13)
update_single_select "$ITEM_13" "$STATUS_FIELD_ID" "$STATUS_TODO"
update_single_select "$ITEM_13" "$PRIORITY_FIELD_ID" "$PRIORITY_HIGH"
update_single_select "$ITEM_13" "$SIZE_FIELD_ID" "$SIZE_M"
update_single_select "$ITEM_13" "$TYPE_FIELD_ID" "$TYPE_FEATURE"
update_single_select "$ITEM_13" "$AREA_FIELD_ID" "$AREA_EVALUATION"
update_iteration "$ITEM_13" "$SPRINT_FIELD_ID" "$SPRINT_2"
update_text "$ITEM_13" "$BLOCKED_FIELD_ID" "#1"
update_number "$ITEM_13" "$EFFORT_FIELD_ID" 8
echo "  ✓ #13 configured"

# Issue #14
echo "Setting metadata for #14 - Implement ProjectWorkflowManager..."
ITEM_14=$(get_project_item_id 14)
update_single_select "$ITEM_14" "$STATUS_FIELD_ID" "$STATUS_TODO"
update_single_select "$ITEM_14" "$PRIORITY_FIELD_ID" "$PRIORITY_HIGH"
update_single_select "$ITEM_14" "$SIZE_FIELD_ID" "$SIZE_M"
update_single_select "$ITEM_14" "$TYPE_FIELD_ID" "$TYPE_FEATURE"
update_single_select "$ITEM_14" "$AREA_FIELD_ID" "$AREA_PROJECTS"
update_iteration "$ITEM_14" "$SPRINT_FIELD_ID" "$SPRINT_2"
update_text "$ITEM_14" "$BLOCKED_FIELD_ID" "#1"
update_number "$ITEM_14" "$EFFORT_FIELD_ID" 10
echo "  ✓ #14 configured"

# Issue #15 - Master Tracking
echo "Setting metadata for #15 - Master Tracking Issue..."
ITEM_15=$(get_project_item_id 15)
update_single_select "$ITEM_15" "$STATUS_FIELD_ID" "$STATUS_IN_PROGRESS"
update_single_select "$ITEM_15" "$PRIORITY_FIELD_ID" "$PRIORITY_CRITICAL"
update_single_select "$ITEM_15" "$SIZE_FIELD_ID" "$SIZE_XL"
update_single_select "$ITEM_15" "$TYPE_FIELD_ID" "$TYPE_EPIC"
update_single_select "$ITEM_15" "$AREA_FIELD_ID" "$AREA_PROJECTS"
update_number "$ITEM_15" "$EFFORT_FIELD_ID" 100
echo "  ✓ #15 configured"

echo ""
echo "✅ All issue metadata configured successfully!"
echo ""
echo "📊 Summary:"
echo "  • Phase 1 (Sprint 1): Issues #1-8 set to 'Ready'"
echo "  • Phase 2-5 (Sprint 2-3): Issues #9-14 set to 'Todo' with blockers"
echo "  • Master Tracking: Issue #15 set to 'In Progress'"
echo ""
echo "🎯 View your project: https://github.com/orgs/stokedconsulting/projects/5"
echo ""
echo "🚀 Ready to start Phase 1 implementation!"
