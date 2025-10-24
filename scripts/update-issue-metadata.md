# Issue Metadata Configuration

After setting up the project fields via the GitHub UI, apply this metadata to each issue:

## Phase 1: Read-Only Integration (Foundation)

### #1 - [Epic] Phase 1: Read-Only GitHub Projects v2 Integration
- **Status**: Ready
- **Priority**: High
- **Size**: L
- **Type**: Epic
- **Area**: Projects
- **Sprint**: Sprint 1
- **Effort Estimate**: 40 hours

### #2 - Implement GitHubProjectsAPI with GraphQL client
- **Status**: Ready
- **Priority**: High
- **Size**: M
- **Type**: Feature
- **Area**: GitHub API
- **Sprint**: Sprint 1
- **Effort Estimate**: 8 hours
- **Parent**: #1

### #3 - Add project field mapping and metadata reading
- **Status**: Ready
- **Priority**: High
- **Size**: M
- **Type**: Feature
- **Area**: Projects
- **Sprint**: Sprint 1
- **Effort Estimate**: 6 hours
- **Parent**: #1

### #4 - Implement project items query with filters
- **Status**: Ready
- **Priority**: High
- **Size**: M
- **Type**: Feature
- **Area**: Projects
- **Sprint**: Sprint 1
- **Effort Estimate**: 8 hours
- **Parent**: #1

### #5 - Add project configuration to .autonomous-config.json
- **Status**: Ready
- **Priority**: High
- **Size**: S
- **Type**: Feature
- **Area**: Core
- **Sprint**: Sprint 1
- **Effort Estimate**: 4 hours
- **Parent**: #1

### #6 - Create 'auto project init' command
- **Status**: Ready
- **Priority**: High
- **Size**: M
- **Type**: Feature
- **Area**: CLI
- **Sprint**: Sprint 1
- **Effort Estimate**: 6 hours
- **Parent**: #1

### #7 - Create 'auto project status' command
- **Status**: Ready
- **Priority**: Medium
- **Size**: S
- **Type**: Feature
- **Area**: CLI
- **Sprint**: Sprint 1
- **Effort Estimate**: 4 hours
- **Parent**: #1

### #8 - Create 'auto project list-ready' command
- **Status**: Ready
- **Priority**: Medium
- **Size**: S
- **Type**: Feature
- **Area**: CLI
- **Sprint**: Sprint 1
- **Effort Estimate**: 4 hours
- **Parent**: #1

---

## Phase 2: Hybrid Prioritization (Intelligence)

### #9 - [Epic] Phase 2: Hybrid Prioritization
- **Status**: Todo
- **Priority**: High
- **Size**: M
- **Type**: Epic
- **Area**: Evaluation
- **Sprint**: Sprint 2
- **Effort Estimate**: 16 hours
- **Blocked By**: #1

### #13 - Implement ProjectAwarePrioritizer class
- **Status**: Todo
- **Priority**: High
- **Size**: M
- **Type**: Feature
- **Area**: Evaluation
- **Sprint**: Sprint 2
- **Effort Estimate**: 8 hours
- **Parent**: #9
- **Blocked By**: #1

---

## Phase 3: Project Status Updates (Automation)

### #10 - [Epic] Phase 3: Project Status Updates
- **Status**: Todo
- **Priority**: High
- **Size**: M
- **Type**: Epic
- **Area**: Projects
- **Sprint**: Sprint 2
- **Effort Estimate**: 16 hours
- **Blocked By**: #1

### #14 - Implement ProjectWorkflowManager for status automation
- **Status**: Todo
- **Priority**: High
- **Size**: M
- **Type**: Feature
- **Area**: Projects
- **Sprint**: Sprint 2
- **Effort Estimate**: 10 hours
- **Parent**: #10
- **Blocked By**: #1

---

## Phase 4: Sprint/Iteration Management (Planning)

### #11 - [Epic] Phase 4: Sprint/Iteration Management
- **Status**: Todo
- **Priority**: Medium
- **Size**: M
- **Type**: Epic
- **Area**: Projects
- **Sprint**: Sprint 3
- **Effort Estimate**: 16 hours
- **Blocked By**: #1, #10

---

## Phase 5: Dependency Tracking (Advanced)

### #12 - [Epic] Phase 5: Dependency Tracking
- **Status**: Todo
- **Priority**: Medium
- **Size**: M
- **Type**: Epic
- **Area**: Projects
- **Sprint**: Sprint 3
- **Effort Estimate**: 16 hours
- **Blocked By**: #1, #10

---

## Master Tracking

### #15 - GitHub Projects v2 Integration - Master Tracking Issue
- **Status**: In Progress
- **Priority**: Critical
- **Size**: XL
- **Type**: Epic
- **Area**: Projects
- **Sprint**: (All sprints)
- **Effort Estimate**: 100 hours

---

## Summary by Status

- **Ready** (Phase 1): #1, #2, #3, #4, #5, #6, #7, #8
- **Todo** (Future phases): #9, #10, #11, #12, #13, #14
- **In Progress** (Tracking): #15

## Summary by Priority

- **Critical**: #15
- **High**: #1, #2, #3, #4, #5, #6, #9, #10, #13, #14
- **Medium**: #7, #8, #11, #12

## Summary by Sprint

- **Sprint 1** (Foundation): #1, #2, #3, #4, #5, #6, #7, #8
- **Sprint 2** (Intelligence & Automation): #9, #10, #13, #14
- **Sprint 3** (Advanced): #11, #12
- **All Sprints** (Tracking): #15

## Total Effort Estimate

- **Phase 1**: 40 hours
- **Phase 2**: 16 hours
- **Phase 3**: 16 hours
- **Phase 4**: 16 hours
- **Phase 5**: 16 hours
- **Total**: ~100 hours
