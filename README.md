# Visor: Multi-Language Code-to-Flowchart Visualization

**Visor** is a powerful VS Code extension that provides real-time, interactive flowchart visualization for your code across multiple programming languages. Transform complex code logic into clear, visual flowcharts that help you understand, debug, and document your code more effectively.

## ✨ Features

### 🔄 **Real-Time Flowchart Generation**

- Automatically generates flowcharts for functions as you navigate your code
- Live updates as you edit your code (500ms debounced for optimal performance)
- Intelligent function detection based on cursor position

### 🌐 **Multi-Language Support**

- **Python**: Functions, lambdas, higher-order functions (map, filter, reduce)
- **TypeScript/JavaScript**: Functions, arrow functions, methods, classes
- **Java**: Methods, classes, constructors
- **C/C++**: Functions and methods

### 🎯 **Interactive Visualization**

- **Bidirectional Navigation**: Click flowchart nodes to jump to code, cursor movement highlights corresponding nodes
- **Smart Highlighting**: Real-time synchronization between code and flowchart
- **Context-Aware**: Automatically detects the current function scope

### 🎨 **Rich Visual Elements**

- **Multiple Node Types**: Process blocks, decision diamonds, terminators, special nodes
- **Mermaid.js Powered**: High-quality, theme-aware diagrams
- **Pan & Zoom**: Navigate complex flowcharts with smooth controls
- **VS Code Theme Integration**: Automatically adapts to light/dark themes

### 📤 **Export Capabilities**

- Export flowcharts as **SVG** (vector graphics) or **PNG** (raster images)
- High-quality exports with proper background and styling
- Perfect for documentation and presentations

### ⚡ **Advanced Code Analysis**

- **Tree-sitter Parsing**: Robust, syntax-aware code analysis
- **Control Flow Analysis**: Accurately represents loops, conditionals, and branches
- **Higher-Order Functions**: Special support for functional programming patterns
- **Performance Optimized**: Efficient parsing with object pooling and caching

## 🚀 How to Use

### Getting Started

1. **Install the Extension**: Search for "Visor" in the VS Code Extensions marketplace
2. **Open a Supported File**: Open any Python, TypeScript, JavaScript, Java, or C/C++ file
3. **Access the Flowchart**: Click the Visor icon in the Activity Bar (left sidebar)

### Navigation & Interaction

1. **Function Selection**: Place your cursor inside any function - the flowchart updates automatically
2. **Code Navigation**: Click any node in the flowchart to jump to the corresponding code
3. **Live Highlighting**: Move your cursor through the code to see real-time highlighting in the flowchart
4. **Export**: Use the export buttons (top-right of flowchart) to save as SVG or PNG

### Supported Language Features

#### Python

- Function definitions (`def function_name():`)
- Lambda expressions (`lambda x: x + 1`)
- Higher-order functions (`map()`, `filter()`, `reduce()`)
- Nested functions and closures

#### TypeScript/JavaScript

- Function declarations (`function name() {}`)
- Arrow functions (`const name = () => {}`)
- Method definitions in classes
- Async/await patterns

#### Java

- Method definitions
- Constructor methods
- Class methods (static and instance)

#### C/C++

- Function definitions
- Method definitions in classes
- Function overloading

## 🛠 Technical Architecture

### Core Components

- **AbstractParser**: Base class providing common parsing functionality
- **Language Services**: Specialized parsers for each supported language
- **FlowchartIR**: Intermediate representation for language-agnostic flowchart generation
- **MermaidGenerator**: Converts IR to Mermaid.js syntax
- **FlowchartViewProvider**: VS Code webview integration

### Performance Features

- **Object Pooling**: Reduces garbage collection overhead
- **String Caching**: Optimized string processing with LRU cache
- **Debounced Updates**: Prevents excessive re-rendering during typing
- **Tree-sitter WASM**: Fast, incremental parsing

## 📋 Requirements

- **Visual Studio Code**: v1.102.0 or newer
- **Node.js**: Required for development (not for end users)
- **Supported Languages**: Python, TypeScript, JavaScript, Java, C, C++

## 🔧 Development

### Prerequisites

- Node.js (v16 or higher)
- Yarn package manager
- VS Code (v1.102.0+)

### Setup

```bash
# Clone the repository
git clone https://github.com/sidhant-sriv/sidvis.git
cd sidvis

# Install dependencies
yarn install

# Build the extension
yarn compile
```

### Development Workflow

```bash
# Watch mode for development
yarn watch

# Launch Extension Development Host
# Press F5 in VS Code or run:
code --extensionDevelopmentPath=.
```

### Available Scripts

- `yarn compile`: Compiles TypeScript to JavaScript
- `yarn watch`: Compiles in watch mode for development
- `yarn package`: Creates production build
- `yarn lint`: Runs ESLint for code quality
- `yarn test`: Runs test suite
- `yarn publish:patch`: Publishes a patch version
- `yarn release`: Full release workflow (test + publish + git tags)

### Project Structure

```
src/
├── extension.ts              # Extension entry point
├── view/
│   └── FlowchartViewProvider.ts  # Main webview provider
├── logic/
│   ├── analyzer.ts           # Language router
│   ├── MermaidGenerator.ts   # Flowchart generation
│   ├── language-services/   # Language-specific parsers
│   │   ├── python/
│   │   ├── typescript/
│   │   ├── java/
│   │   └── cpp/
│   ├── common/
│   │   ├── AbstractParser.ts    # Base parser class
│   │   └── AstParserTypes.ts    # Shared types
│   └── utils/
│       └── StringProcessor.ts   # String utilities
├── ir/
│   └── ir.ts                # Intermediate representation
└── types/                   # TypeScript declarations
```

### Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass (`yarn test`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

### Language Parser Development

To add support for a new language:

1. **Add Tree-sitter Grammar**: Include the WASM file in `src/logic/language-services/[language]/`
2. **Implement Parser**: Extend `AbstractParser` class
3. **Register Language**: Add to `analyzer.ts` and `language-services/index.ts`
4. **Update Webpack**: Add WASM file copy rule to `webpack.config.js`

Example parser structure:

```typescript
export class NewLangParser extends AbstractParser {
  public static async create(wasmPath: string): Promise<NewLangParser> {
    // Initialize tree-sitter parser
  }

  public generateFlowchart(sourceCode: string, position?: number): FlowchartIR {
    // Parse and generate flowchart IR
  }
}
```

### Testing

```bash
# Run all tests
yarn test

# Run specific test file
yarn test --grep "parser"

# Debug tests in VS Code
# Use the "Run Extension Tests" configuration
```

## 🐛 Troubleshooting

### Common Issues

**Flowchart not generating:**

- Ensure your cursor is inside a function
- Check that the file language is supported
- Look for errors in the VS Code Developer Console (Help > Toggle Developer Tools)

**Export not working:**

- Ensure you have sufficient disk space
- Check file permissions in the target directory
- Try exporting to a different location

**Performance issues:**

- Large functions may take longer to process
- Consider breaking down complex functions
- Check if multiple heavy operations are running simultaneously

### Debug Mode

Enable debug logging by setting the `visor.debug` configuration in VS Code settings.

## 📊 Supported Control Structures

### All Languages

- **Sequential**: Statements, assignments, function calls
- **Conditional**: if/else, switch/case, ternary operators
- **Loops**: for, while, do-while loops
- **Jump Statements**: break, continue, return

### Language-Specific Features

#### Python

- List comprehensions
- Higher-order functions (`map`, `filter`, `reduce`)
- Exception handling (`try`/`except`)
- Context managers (`with` statements)

#### TypeScript/JavaScript

- Promise chains and async/await
- Array methods (`forEach`, `map`, `filter`)
- Class methods and constructors
- Module imports/exports

#### Java

- Exception handling (`try`/`catch`)
- Enhanced for loops
- Method overloading
- Constructor chaining

#### C/C++

- Pointer operations
- Memory management
- Function overloading
- Template functions (basic support)

## 🔒 Privacy & Security

Visor processes your code locally within VS Code. No code is transmitted to external servers. All parsing and flowchart generation happens on your machine, ensuring your code remains private and secure.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Tree-sitter**: For robust, incremental parsing
- **Mermaid.js**: For beautiful diagram rendering
- **VS Code API**: For seamless editor integration
- **svg-pan-zoom**: For interactive flowchart navigation


Code with <❤️> Visor