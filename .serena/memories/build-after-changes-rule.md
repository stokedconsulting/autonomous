# Build After Code Changes Rule

**CRITICAL RULE**: Always run `pnpm build` after making code changes to catch TypeScript errors early.

## When to Build
- After editing any TypeScript files
- After creating new files  
- Before considering a task complete
- After fixing errors (to verify the fix)

## Build Command
```bash
pnpm build
```

## Why This Matters
- Catches TypeScript errors immediately
- Prevents accumulation of build errors
- Ensures code changes are valid before proceeding
- User explicitly requested this workflow

## Process
1. Make code changes
2. Run `pnpm build`
3. If errors appear, fix them
4. Repeat until build succeeds
5. Only then mark task as complete

This rule was established on 2025-12-30 per explicit user request: "always build after you change code can you put that in your rules for this project please"
