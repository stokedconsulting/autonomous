# UI Default Tab Fix

## Issue
When running `auto` with no arguments and no active assignments, the Status tab was shown by default instead of the Projects tab.

## Root Cause
In `src/ui/index.tsx`, both `renderUI()` and `createInkInstance()` functions had hardcoded defaults of `initialView = 'status'`, which overrode the UI store's default of `'project'`.

## Solution
Changed the default `initialView` from `'status'` to `'project'` in both functions (lines 21 and 42).

## Result
Now when running `auto` with no active assignments:
- Shows Projects tab by default (tab 2)
- User can still navigate to Status tab (tab 1) if needed
- Provides immediate access to project selection and work initiation

## Files Modified
- `src/ui/index.tsx` - Changed default initialView in renderUI() and createInkInstance()
