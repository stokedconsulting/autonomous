# Contributing to Autonomous

Thank you for your interest in contributing to Autonomous! This document provides guidelines and instructions for contributing.

## Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/stokedconsulting/autonomous.git
   cd autonomous
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the project**
   ```bash
   npm run build
   ```

4. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env and add your GitHub token
   ```

5. **Link for local development**
   ```bash
   npm link
   ```

## Project Structure

```
src/
├── cli/           # CLI commands and interface
├── core/          # Core business logic
├── github/        # GitHub API integration
├── git/           # Git operations (worktrees, branches)
├── llm/           # LLM adapters and prompt building
├── hooks/         # Hook management
└── types/         # TypeScript type definitions
```

## Development Workflow

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Write code following the existing patterns
   - Add TypeScript types for all new code
   - Follow the ESLint configuration

3. **Build and test**
   ```bash
   npm run build
   npm test
   ```

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

5. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   ```

## Commit Message Guidelines

We follow conventional commits:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Test additions or updates
- `chore:` - Build process or tooling changes

Examples:
- `feat: add gemini adapter support`
- `fix: handle worktree creation errors`
- `docs: update README with installation steps`

## Adding a New LLM Adapter

To add support for a new LLM provider:

1. **Create adapter file**
   ```bash
   touch src/llm/your-llm-adapter.ts
   ```

2. **Implement LLMAdapter interface**
   ```typescript
   import { LLMAdapter, LLMStatus, StartLLMOptions } from './adapter.js';

   export class YourLLMAdapter implements LLMAdapter {
     readonly provider = 'your-llm' as const;

     async start(options: StartLLMOptions): Promise<string> {
       // Implementation
     }

     async stop(instanceId: string): Promise<void> {
       // Implementation
     }

     // ... other required methods
   }
   ```

3. **Register adapter in orchestrator**
   Update `src/core/orchestrator.ts` to include your adapter.

4. **Add configuration support**
   Update `src/types/config.ts` to include settings for your LLM.

5. **Test your adapter**
   Create tests in `src/llm/__tests__/your-llm-adapter.test.ts`

## Testing

We use Jest for testing:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage
```

## Code Style

- Use TypeScript for all code
- Follow the existing code style
- Run `npm run lint` to check for issues
- Run `npm run format` to auto-format code

## Documentation

- Update README.md for user-facing changes
- Update ARCHITECTURE.md for architectural changes
- Add JSDoc comments for public APIs
- Include examples in documentation

## Pull Request Process

1. Ensure all tests pass
2. Update documentation as needed
3. Describe your changes in the PR description
4. Link any related issues
5. Request review from maintainers

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for questions or ideas
- Check existing issues before creating new ones

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
