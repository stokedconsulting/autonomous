#!/bin/bash

# Setup GitHub Project v2 Fields (Smart Version)
# Only creates fields that don't already exist

set -e

PROJECT_ID="PVT_kwDOBW_6Ns4BGTch"

echo "🚀 Setting up GitHub Project fields..."
echo ""

# Helper function to run GraphQL
run_graphql() {
  gh api graphql -f query="$1"
}

# Check existing fields
echo "📋 Checking existing fields..."
EXISTING_FIELDS=$(run_graphql 'query {
  node(id: "'"$PROJECT_ID"'") {
    ... on ProjectV2 {
      fields(first: 20) {
        nodes {
          ... on ProjectV2Field {
            name
          }
        }
      }
    }
  }
}' | jq -r '.data.node.fields.nodes[].name')

echo "Found existing fields:"
echo "$EXISTING_FIELDS" | sed 's/^/  - /'
echo ""

# Function to check if field exists
field_exists() {
  echo "$EXISTING_FIELDS" | grep -q "^$1$"
}

# Create Priority field (if it doesn't exist)
if ! field_exists "Priority"; then
  echo "📊 Creating Priority field..."
  run_graphql 'mutation {
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
  }' > /dev/null
  echo "✓ Priority field created"
else
  echo "⏭️  Priority field already exists, skipping"
fi

# Create Size field (if it doesn't exist)
if ! field_exists "Size"; then
  echo "📊 Creating Size field..."
  run_graphql 'mutation {
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
  }' > /dev/null
  echo "✓ Size field created"
else
  echo "⏭️  Size field already exists, skipping"
fi

# Create Type field (if it doesn't exist)
if ! field_exists "Type"; then
  echo "📊 Creating Type field..."
  run_graphql 'mutation {
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
  }' > /dev/null
  echo "✓ Type field created"
else
  echo "⏭️  Type field already exists, skipping"
fi

# Create Area field (if it doesn't exist)
if ! field_exists "Area"; then
  echo "📊 Creating Area field..."
  run_graphql 'mutation {
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
  }' > /dev/null
  echo "✓ Area field created"
else
  echo "⏭️  Area field already exists, skipping"
fi

# Create Sprint field (if it doesn't exist)
if ! field_exists "Sprint"; then
  echo "📊 Creating Sprint field..."
  run_graphql 'mutation {
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
        }
      }
    }
  }' > /dev/null
  echo "✓ Sprint field created (2-week iterations starting Monday)"
else
  echo "⏭️  Sprint field already exists, skipping"
fi

# Create Blocked By field (if it doesn't exist)
if ! field_exists "Blocked By"; then
  echo "📊 Creating Blocked By field..."
  run_graphql 'mutation {
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
  }' > /dev/null
  echo "✓ Blocked By field created"
else
  echo "⏭️  Blocked By field already exists, skipping"
fi

# Create Effort Estimate field (if it doesn't exist)
if ! field_exists "Effort Estimate"; then
  echo "📊 Creating Effort Estimate field..."
  run_graphql 'mutation {
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
  }' > /dev/null
  echo "✓ Effort Estimate field created"
else
  echo "⏭️  Effort Estimate field already exists, skipping"
fi

echo ""
echo "✅ Project field setup complete!"
echo ""
echo "📋 To configure Status field options, visit:"
echo "   https://github.com/orgs/stokedconsulting/projects/5/settings/fields"
echo ""
echo "   Add these options to the Status field:"
echo "   - Todo (gray) - Work not yet started"
echo "   - Ready (green) - Ready to be picked up"
echo "   - In Progress (yellow) - Currently being worked on"
echo "   - In Review (blue) - PR created, awaiting review"
echo "   - Blocked (red) - Blocked by dependencies or issues"
echo "   - Done (purple) - Work completed and merged"
