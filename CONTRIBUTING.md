# Contributing to Vamp

Thank you for your interest in contributing to Vamp! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Submitting Changes](#submitting-changes)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)

## Code of Conduct

This project follows a simple code of conduct:
- Be respectful and constructive in all interactions
- Focus on what is best for the community
- Show empathy towards other community members

## Getting Started

### Prerequisites

Before contributing, ensure you have:
- macOS 13 or later
- Node.js 22.13 or later
- Ableton Live 12.4 Suite (for testing)
- Basic understanding of the project architecture (see [docs/reference/architecture.md](docs/reference/architecture.md))

### Setting Up Your Development Environment

1. **Fork the repository** on GitHub

2. **Clone your fork:**
   ```bash
   git clone https://github.com/YOUR-USERNAME/vamp.git
   cd vamp
   ```

3. **Add upstream remote:**
   ```bash
   git remote add upstream https://github.com/ben-juodvalkis/vamp.git
   ```

4. **Install dependencies:**
   ```bash
   npm run setup
   ```

5. **Configure the project:**
   ```bash
   # config/constants.json is TRACKED: the defaults every Mac shares. Your
   # Mac's own values go in config/constants.local.json (gitignored), laid
   # over it — see INSTALLATION.md, "Your own settings".
   npm run validate
   ```

6. **Confirm the pre-push gate is active:**
   ```bash
   git config core.hooksPath   # should print: .githooks
   ```
   `npm run setup` sets this automatically via the root `prepare`
   script. If it prints nothing, run `git config core.hooksPath .githooks`.
   This hook is the project's only gate — there is no CI that runs tests or
   builds — so a clone without it pushes unverified.

7. **Optional: make `.amxd` devices diffable:**
   ```bash
   git config diff.amxd.textconv 'tail -c +33'
   ```
   Max for Live devices are plain JSON behind a fixed 32-byte header.
   `.gitattributes` marks them `binary diff=amxd`, so without this they show
   as `Bin N -> M bytes`; with it you get a readable JSON diff. Per-clone,
   the same as `core.hooksPath` above — git will not store a textconv for you.

8. **Read the developer guide:**
   See [CLAUDE.md](CLAUDE.md) for detailed development guidelines and project structure.

## Development Workflow

### Creating a Feature Branch

```bash
# Update your main branch
git checkout main
git pull upstream main

# Create a feature branch
git checkout -b feature/your-feature-name
```

### Making Changes

1. **Follow the project structure** outlined in [CLAUDE.md](CLAUDE.md)
2. **Use existing patterns** - check similar implementations before creating new patterns
3. **Test your changes** thoroughly in development mode
4. **Update documentation** if you're changing behavior or adding features

### Testing Your Changes

```bash
# Run validation
npm run validate

# Start development server
npm run dev

# Run tests (if applicable)
npm run test
```

### Keeping Your Branch Updated

```bash
# Fetch latest changes
git fetch upstream

# Rebase your branch
git rebase upstream/main
```

## Coding Standards

### General Guidelines

- **Never hardcode configuration values** - use `config/constants.json`
- **Prefer editing existing files** over creating new ones
- **Don't create documentation files** unless absolutely necessary
- **Use the logging utilities** instead of `console.log` (see [CLAUDE.md](CLAUDE.md#logging))

### TypeScript/JavaScript

- Use TypeScript for new code in the interface
- Follow existing code style and patterns
- Use Svelte 5 runes for reactive state
- Keep components focused and single-purpose

### File Organization

```
interface/src/lib/
├── components/v6/    # Svelte 5 components
├── stores/v6/        # Svelte 5 runes stores
├── services/         # Business logic
└── utils/           # Utility functions
```

### Logging Levels

Use appropriate log levels:
- `logger.debug()` - Frequent events (message routing, state updates)
- `logger.info()` - Significant events (connections, startup)
- `logger.warn()` - Recoverable issues
- `logger.error()` - Failures requiring attention

## Submitting Changes

### Before Submitting

- [ ] Code follows project conventions
- [ ] Configuration uses `config/constants.json` (no hardcoded paths)
- [ ] Changes tested in development mode
- [ ] Documentation updated if needed
- [ ] Validation passes (`npm run validate`)
- [ ] `npm run test:run`, `pytest` and `npm run build` all pass — the
      pre-push hook runs these three; if you bypassed it with `--no-verify`,
      run them by hand
- [ ] Commit messages are clear and descriptive

### Pull Request Process

1. **Push your changes:**
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Create a Pull Request** on GitHub with:
   - Clear description of changes
   - Reference to related issue (if applicable)
   - Screenshots/videos for UI changes
   - Testing steps

3. **Respond to feedback** - be open to suggestions and iterate

4. **Keep PR focused** - one feature or fix per PR

### Commit Message Guidelines

Use clear, descriptive commit messages:

```
feat: add support for Audio Effect Rack macros

- Implement macro parameter queries
- Add UI controls for 16 macros
- Update documentation

Closes #123
```

**Format:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Test additions/changes
- `chore:` - Build/tooling changes

## Reporting Bugs

### Before Reporting

1. **Check existing issues** - your bug may already be reported
2. **Verify it's a bug** - run `npm run validate` to check configuration
3. **Test on latest version** - pull latest changes and try again

### Bug Report Template

Use the GitHub issue template when reporting bugs. Include:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- System information (macOS version, Node.js version, Ableton version)
- Relevant logs or error messages
- Configuration details (anonymized paths)

## Suggesting Features

### Feature Request Guidelines

- **Check existing issues** first
- **Describe the use case** - why is this needed?
- **Propose a solution** if you have ideas
- **Consider alternatives** - are there existing features that could work?

### Discussion

Major features should be discussed in an issue before implementation to:
- Ensure alignment with project goals
- Get feedback on approach
- Avoid duplicate work

## Questions?

- **Documentation:** Start with [CLAUDE.md](CLAUDE.md) and files in `docs/`
- **Setup Issues:** See [INSTALLATION.md](INSTALLATION.md#troubleshooting) and [docs/reference/setup.md](docs/reference/setup.md)
- **Architecture:** Read [docs/reference/architecture.md](docs/reference/architecture.md)
- **Need help?** Open a discussion issue

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
