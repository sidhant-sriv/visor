# Visor VS Code Extension Development Guide

Visor is a VS Code extension that generates real-time, interactive flowcharts for code in Python, TypeScript/JavaScript, Java, C++, C, and Rust. It uses Tree-sitter for parsing and Mermaid.js for rendering.

**Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.**

## Essential Setup and Build Commands

### Prerequisites
- Node.js 20.x (verified working with v20.19.4)
- VS Code 1.102.0+ (for testing the extension)
- Either yarn or npm (both package managers work)

### Bootstrap the Repository
```bash
# Clone and install dependencies
# TIMING: ~45 seconds for yarn install (first time), ~1.5 seconds for npm install (if yarn already ran)
yarn install
# OR
npm install
```

**Warning:** The project contains both `package-lock.json` and `yarn.lock`. Either package manager works, but yarn will show a warning about mixed lock files.

### Build Commands (NEVER CANCEL - All Complete Quickly)

```bash
# Development build - takes ~4 seconds, NEVER CANCEL
yarn run compile
# OR  
npm run compile

# Production build - takes ~6 seconds, NEVER CANCEL  
yarn run package
# OR
npm run package

# TypeScript compilation - takes ~2 seconds, NEVER CANCEL
yarn run compile-tests
# OR
npm run compile-tests

# Linting - takes ~2 seconds, NEVER CANCEL
yarn run lint
# OR  
npm run lint

# Full pretest sequence - takes ~8.5 seconds, NEVER CANCEL
yarn run pretest
# OR
npm run pretest
```

### Development Workflow

```bash
# Start watch mode for continuous development - NEVER CANCEL
yarn run watch
# OR
npm run watch

# Watch mode will continuously rebuild on file changes
# Keep this running in a separate terminal during development
```

## Build Outputs and Structure

### Key Directories
- `src/` - TypeScript source code (33 TypeScript files)
- `dist/` - Production build output (webpack bundle + WASM files)
- `out/` - TypeScript compilation output (for debugging)
- `media/` - Extension assets (icon.png)

### Build Artifacts in `dist/`
- `extension.js` - Main extension bundle (~501KB development, ~268KB production)
- `tree-sitter-*.wasm` - Language parser WASM files:
  - `tree-sitter-cpp.wasm` (3.28MB)
  - `tree-sitter-typescript.wasm` (1.35MB) 
  - `tree-sitter-rust.wasm` (1MB)
  - `tree-sitter-c.wasm` (606KB)
  - `tree-sitter-python.wasm` (448KB)
  - `tree-sitter-java.wasm` (405KB)
  - `tree-sitter.wasm` (184KB)

## Testing and Validation

### Known Testing Limitations
- `yarn run test` or `npm run test` will FAIL - this is expected
- The test command tries to download VS Code which is network restricted in CI environments
- No actual test files exist (test framework is configured but unused)
- Extension functionality requires VS Code to validate properly

### Validation Steps You CAN Perform
1. **Build Validation:**
   ```bash
   # Verify all builds complete successfully
   yarn run pretest  # ~8.5 seconds
   
   # Check that dist/ contains extension.js and all WASM files
   ls -la dist/
   ```

2. **Code Quality:**
   ```bash
   # Linting shows 45 warnings but 0 errors (expected)
   yarn run lint
   ```

3. **Extension Packaging:**
   ```bash
   # Verify extension can be packaged (requires @vscode/vsce)
   npx vsce package --no-yarn
   ```

### Manual Validation for VS Code Extension Development
- **ALWAYS** test any code changes by running the extension in VS Code's Extension Development Host
- Use VS Code's "Run Extension" launch configuration (F5) to test changes
- Test with sample code files in supported languages (Python, TypeScript, Java, C++, C, Rust)
- Verify flowcharts generate correctly by placing cursor in functions
- Test bidirectional navigation (click flowchart nodes to jump to code)

## Development Best Practices

### Code Style
- ESLint is configured and will show style warnings
- 45 ESLint warnings exist in codebase (mostly missing braces) - this is current baseline
- Always run `yarn run lint` before committing changes

### File Modifications
- Main extension entry point: `src/extension.ts`
- Language parsers: `src/logic/language-services/`
- Flowchart rendering: `src/logic/MermaidGenerator.ts`, `src/logic/EnhancedMermaidGenerator.ts`
- UI components: `src/view/`

### Watch Mode Development
- Use `yarn run watch` or `npm run watch` for continuous building during development
- VS Code will auto-reload the extension when files change in watch mode
- Keep watch mode running in a separate terminal

## Common Commands Reference

```bash
# Quick development cycle
yarn install                    # ~1.5s if already installed
yarn run compile               # ~4s - development build  
yarn run lint                  # ~2s - check code style

# Full validation (run before committing)
yarn run pretest              # ~8.5s - compile, build, and lint

# Production build
yarn run package              # ~6s - minified production build

# Development mode
yarn run watch                 # continuous building (keep running)
```

## Key Project Information

### Technology Stack
- **Language:** TypeScript
- **Build:** Webpack 5 with ts-loader
- **Parsing:** Tree-sitter with language-specific WASM files
- **Rendering:** Mermaid.js for flowcharts
- **Target:** VS Code extension API 1.102.0+

### Supported Languages
- Python (PyAstParser.ts)
- TypeScript/JavaScript (TsAstParser.ts) 
- Java (JavaAstParser.ts)
- C++ (CppAstParser.ts)
- C (CAstParser.ts)
- Rust (RustAstParser.ts)

### No CI/CD Pipeline
- No GitHub Actions workflows exist
- No automated testing in CI
- Manual validation required for all changes
- Extension publishing uses vsce commands in package.json

### Complexity Analysis
- Built-in cyclomatic complexity analysis
- Configurable complexity thresholds
- Visual indicators in flowcharts (⚠️, 🔴, 🚨)

## Troubleshooting

### Build Issues
- If webpack fails, check that all WASM files exist in language-services subdirectories
- Clear build cache: `rm -rf dist/ out/` then rebuild
- Mixed lock files warning from yarn is harmless

### VS Code Integration Issues  
- Extension requires VS Code 1.102.0+
- Use Extension Development Host (F5) to test changes
- Check VS Code Developer Console for runtime errors
- Ensure dist/ folder contains all required files before testing

### Performance
- Builds are fast (under 10 seconds for all commands)
- WASM files are large but necessary for language parsing
- Production builds are significantly smaller than development builds

Always validate your changes work in VS Code before considering them complete.