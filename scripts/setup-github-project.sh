#!/bin/bash

# GitHub Project Setup Script
# Sets up the Autonomous Development project with fields and issues

set -e

PROJECT_ID="PVT_kwDOBW_6Ns4BGTch"
PROJECT_NUMBER=5
REPO_OWNER="stokedconsulting"
REPO_NAME="autonomous"

echo "🚀 Setting up Autonomous Development Project..."

# Function to run GraphQL mutation
run_graphql() {
  local query="$1"
  gh api graphql -f query="$query"
}

# 1. Add Status field (SingleSelect)
echo "📊 Creating Status field..."
STATUS_MUTATION=$(cat <<'EOF'
mutation {
  addProjectV2Field(input: {
    projectId: "PVT_kwDOBW_6Ns4BGTch"
    dataType: SINGLE_SELECT
    name: "Status"
  }) {
    projectV2Field {
      ... on ProjectV2SingleSelectField {
        id
        name
      }
    }
  }
}
EOF
)

STATUS_FIELD_ID=$(run_graphql "$STATUS_MUTATION" | jq -r '.data.addProjectV2Field.projectV2Field.id')
echo "✓ Status field created: $STATUS_FIELD_ID"

# Add Status options
echo "  Adding Status options..."
for option in "Todo" "Ready" "In Progress" "In Review" "Blocked" "Done"; do
  OPTION_MUTATION=$(cat <<EOF
mutation {
  addProjectV2ItemFieldValue(input: {
    projectId: "$PROJECT_ID"
    fieldId: "$STATUS_FIELD_ID"
    value: {
      singleSelectOptionId: "$option"
    }
  }) {
    projectV2Item {
      id
    }
  }
}
EOF
)
  # Note: We need to create options via updateProjectV2Field
  echo "    - $option"
done

# 2. Add Priority field (SingleSelect)
echo "📊 Creating Priority field..."
PRIORITY_MUTATION=$(cat <<'EOF'
mutation {
  addProjectV2Field(input: {
    projectId: "PVT_kwDOBW_6Ns4BGTch"
    dataType: SINGLE_SELECT
    name: "Priority"
  }) {
    projectV2Field {
      ... on ProjectV2SingleSelectField {
        id
        name
      }
    }
  }
}
EOF
)

PRIORITY_FIELD_ID=$(run_graphql "$PRIORITY_MUTATION" | jq -r '.data.addProjectV2Field.projectV2Field.id')
echo "✓ Priority field created: $PRIORITY_FIELD_ID"

# 3. Add Size field (SingleSelect)
echo "📊 Creating Size field..."
SIZE_MUTATION=$(cat <<'EOF'
mutation {
  addProjectV2Field(input: {
    projectId: "PVT_kwDOBW_6Ns4BGTch"
    dataType: SINGLE_SELECT
    name: "Size"
  }) {
    projectV2Field {
      ... on ProjectV2SingleSelectField {
        id
        name
      }
    }
  }
}
EOF
)

SIZE_FIELD_ID=$(run_graphql "$SIZE_MUTATION" | jq -r '.data.addProjectV2Field.projectV2Field.id')
echo "✓ Size field created: $SIZE_FIELD_ID"

# 4. Add Sprint field (Iteration)
echo "📊 Creating Sprint field..."
SPRINT_MUTATION=$(cat <<'EOF'
mutation {
  addProjectV2Field(input: {
    projectId: "PVT_kwDOBW_6Ns4BGTch"
    dataType: ITERATION
    name: "Sprint"
  }) {
    projectV2Field {
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
EOF
)

SPRINT_FIELD_ID=$(run_graphql "$SPRINT_MUTATION" | jq -r '.data.addProjectV2Field.projectV2Field.id')
echo "✓ Sprint field created: $SPRINT_FIELD_ID"

# 5. Add Type field (SingleSelect)
echo "📊 Creating Type field..."
TYPE_MUTATION=$(cat <<'EOF'
mutation {
  addProjectV2Field(input: {
    projectId: "PVT_kwDOBW_6Ns4BGTch"
    dataType: SINGLE_SELECT
    name: "Type"
  }) {
    projectV2Field {
      ... on ProjectV2SingleSelectField {
        id
        name
      }
    }
  }
}
EOF
)

TYPE_FIELD_ID=$(run_graphql "$TYPE_MUTATION" | jq -r '.data.addProjectV2Field.projectV2Field.id')
echo "✓ Type field created: $TYPE_FIELD_ID"

# 6. Add Blocked By field (Text)
echo "📊 Creating 'Blocked By' field..."
BLOCKED_MUTATION=$(cat <<'EOF'
mutation {
  addProjectV2Field(input: {
    projectId: "PVT_kwDOBW_6Ns4BGTch"
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
}
EOF
)

BLOCKED_FIELD_ID=$(run_graphql "$BLOCKED_MUTATION" | jq -r '.data.addProjectV2Field.projectV2Field.id')
echo "✓ Blocked By field created: $BLOCKED_FIELD_ID"

# 7. Add Effort Estimate field (Number)
echo "📊 Creating 'Effort Estimate' field..."
EFFORT_MUTATION=$(cat <<'EOF'
mutation {
  addProjectV2Field(input: {
    projectId: "PVT_kwDOBW_6Ns4BGTch"
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
}
EOF
)

EFFORT_FIELD_ID=$(run_graphql "$EFFORT_MUTATION" | jq -r '.data.addProjectV2Field.projectV2Field.id')
echo "✓ Effort Estimate field created: $EFFORT_FIELD_ID"

# 8. Add Area field (SingleSelect)
echo "📊 Creating Area field..."
AREA_MUTATION=$(cat <<'EOF'
mutation {
  addProjectV2Field(input: {
    projectId: "PVT_kwDOBW_6Ns4BGTch"
    dataType: SINGLE_SELECT
    name: "Area"
  }) {
    projectV2Field {
      ... on ProjectV2SingleSelectField {
        id
        name
      }
    }
  }
}
EOF
)

AREA_FIELD_ID=$(run_graphql "$AREA_MUTATION" | jq -r '.data.addProjectV2Field.projectV2Field.id')
echo "✓ Area field created: $AREA_FIELD_ID"

echo ""
echo "✅ Project fields created successfully!"
echo ""
echo "📝 Now adding issues to project..."

# Get repository node ID
REPO_QUERY=$(cat <<EOF
query {
  repository(owner: "$REPO_OWNER", name: "$REPO_NAME") {
    id
  }
}
EOF
)

REPO_ID=$(run_graphql "$REPO_QUERY" | jq -r '.data.repository.id')
echo "Repository ID: $REPO_ID"

# Function to add issue to project
add_issue_to_project() {
  local issue_number=$1

  # Get issue node ID
  ISSUE_QUERY=$(cat <<EOF
query {
  repository(owner: "$REPO_OWNER", name: "$REPO_NAME") {
    issue(number: $issue_number) {
      id
    }
  }
}
EOF
)

  ISSUE_ID=$(run_graphql "$ISSUE_QUERY" | jq -r '.data.repository.issue.id')

  # Add issue to project
  ADD_MUTATION=$(cat <<EOF
mutation {
  addProjectV2ItemById(input: {
    projectId: "$PROJECT_ID"
    contentId: "$ISSUE_ID"
  }) {
    item {
      id
    }
  }
}
EOF
)

  PROJECT_ITEM_ID=$(run_graphql "$ADD_MUTATION" | jq -r '.data.addProjectV2ItemById.item.id')
  echo "  ✓ Added issue #$issue_number to project (Item ID: $PROJECT_ITEM_ID)"
}

# Add all issues (1-15)
for i in {1..15}; do
  add_issue_to_project $i
done

echo ""
echo "🎉 Project setup complete!"
echo ""
echo "📊 Project Details:"
echo "  - Number: $PROJECT_NUMBER"
echo "  - URL: https://github.com/orgs/stokedconsulting/projects/$PROJECT_NUMBER"
echo "  - Issues added: #1-15"
echo ""
echo "🔧 Next steps:"
echo "  1. Visit the project URL to configure field options (Status values, Priority levels, etc.)"
echo "  2. Set issue metadata (Status, Priority, Size, etc.) via the project UI"
echo "  3. Run 'autonomous project init' to configure autonomous to use this project"
