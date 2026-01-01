# Unified Project Creation Workflow

## Overview

Both file paths and text descriptions now flow through the same validation/enrichment pipeline:

```
User Input (file OR description)
         ↓
   File exists?
    ┌────┴────┐
   Yes        No
    ↓          ↓
  Parse    Generate .md
    ↓          ↓
    └────┬─────┘
         ↓
  ProjectSpecification
         ↓
     Validate
         ↓
   Enhance (if needed)
         ↓
   Review with user
         ↓
  Create GitHub Project
```

## CLI Integration Example

```typescript
// In src/cli/commands/project.ts

import { unifiedProjectCreation } from '../../services/unified-project-creation.js';

export async function projectCreateCommand(
  input: string,  // Can be file path OR description
  options: ProjectCreateOptions
): Promise<void> {
  console.log(chalk.blue.bold('\n🎯 Creating New Project\n'));

  const cwd = process.cwd();
  const configManager = new ConfigManager(cwd);
  await configManager.initialize();
  const config = configManager.getConfig();

  const claudePath = config.llms.claude?.cliPath || 'claude';

  // Unified workflow handles both file and description
  const result = await unifiedProjectCreation(input, {
    claudePath,
    workingDirectory: cwd,
    review: options.review ?? true,
    autoFill: options.autoFill ?? true,
    verbose: options.verbose ?? false,
  });

  // Use result.legacyFormat with existing GitHub creation code
  const { projectTitle, items } = result.legacyFormat;

  // Create GitHub Project (existing code)
  const discovery = new ProjectDiscovery(config.github.owner, config.github.repo);
  const newProject = await discovery.createProject(projectTitle);

  await createProjectIssues(items, projectTitle, octokit, ...);

  console.log(chalk.green(`\n✅ Project "${projectTitle}" created!\n`));
}
```

## Usage Examples

### Text Description
```bash
auto project create "Build a user authentication system with JWT tokens"
```

**What happens:**
1. ✅ Generates Markdown spec using Claude
2. ✅ Shows generated spec for review
3. ✅ User can refine with feedback or approve
4. ✅ Validates the spec
5. ✅ Enriches any gaps
6. ✅ Creates GitHub Project

### File Path
```bash
auto project create ./specs/auth-system.md
```

**What happens:**
1. ✅ Reads existing Markdown file
2. ✅ Validates the spec
3. ✅ Enriches any gaps
4. ✅ Shows changes for review
5. ✅ Creates GitHub Project

### With Options
```bash
# Skip review workflow
auto project create "Build dashboard" --no-review

# Skip auto-fill
auto project create ./spec.md --no-auto-fill

# Verbose output
auto project create "API service" --review --verbose
```

## Markdown Specification Format

```markdown
# Project: Authentication System
Build a secure JWT-based authentication system for the web application.

## Phase 1: Backend API
Core authentication endpoints and JWT token management.

### Item 1.1: User Registration Endpoint
Create POST /api/auth/register endpoint that accepts email and password,
validates input, hashes password with bcrypt, and stores user in database.

**Acceptance Criteria:**
- Endpoint validates email format and password strength
- Password is hashed before storage
- Returns 201 with user object (excluding password)
- Returns 400 for validation errors

**Technical Details:**
Use Express.js for routing, bcrypt for password hashing (10 rounds),
and Postgres for user storage. Implement input validation with Joi schema.

**Dependencies:**
[None for first item]

### Item 1.2: Login Endpoint
Create POST /api/auth/login that verifies credentials and issues JWT token.

**Acceptance Criteria:**
- Validates email and password against database
- Returns JWT token with 24-hour expiration
- Returns 401 for invalid credentials
- Token includes user ID and role claims

**Technical Details:**
Use jsonwebtoken library with HS256 algorithm. Store JWT secret in
environment variables. Implement rate limiting (5 attempts per minute).

**Dependencies:**
- Phase 1, Item 1.1 (item) - Needs user registration to exist

## Phase 2: Frontend Integration
User interface for authentication flows.

### Item 2.1: Login Form Component
React component with email/password inputs and form validation.

**Acceptance Criteria:**
- Form validates email format and password presence
- Shows loading state during submission
- Displays error messages from API
- Redirects to dashboard on success

**Technical Details:**
Use React Hook Form for validation, Axios for API calls, and React Router
for navigation. Store JWT token in localStorage with httpOnly consideration.

**Dependencies:**
- Phase 1 (phase) - Backend API must be complete
```

## Benefits

1. **Single Workflow**: Both inputs use the same validation/enrichment
2. **Consistent Quality**: All projects get validated and enriched
3. **User Choice**: Can start with description or pre-written spec
4. **Iterative**: Can refine generated specs before approval
5. **Saved Specs**: Generated specs saved to `claudedocs/` for reuse

## Implementation Status

✅ **Core Services Complete**
- Type system
- Markdown/JSON/YAML parser
- Validation engine (syntax, structure, dependencies, completeness)
- Gap analysis
- Claude enrichment
- Dependency graph with cycle detection
- Spec generator from description
- Unified workflow

⏳ **Integration Needed**
- Update `projectCreateCommand` in CLI
- Add to TUI workflow
- Update orchestrator for inter-phase dependencies

## Next Steps

1. Replace existing `projectCreateCommand` with unified workflow
2. Update CLI command registration to accept file paths
3. Add TUI support for file selection
4. Update orchestrator to use dependency graph for work assignment
