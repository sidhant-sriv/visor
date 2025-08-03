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

- **Semantic Node Types**: Enhanced visual differentiation between entry/exit, decisions, processes, loops, exceptions, and assignments
- **Subtle Theme-Aware Styling**: Professional color palette that adapts to VS Code light/dark themes without overwhelming visual noise
- **Enhanced Typography**: Improved font weights and sizing for better text readability
- **Smart Border Patterns**: Dashed borders for decisions, double borders for entry/exit, dotted for exceptions
- **Interactive Enhancements**: Smooth hover effects and subtle drop shadows for better user experience
- **Mermaid.js Powered**: High-quality, theme-aware diagrams with enhanced semantic styling
- **Pan & Zoom**: Navigate complex flowcharts with smooth controls
- **VS Code Theme Integration**: Automatically adapts to light/dark themes with subtle accent colors

### 📤 **Export Capabilities**

- Export flowcharts as **SVG** (vector graphics) or **PNG** (raster images)
- High-quality exports with proper background and styling
- Perfect for documentation and presentations

### ⚡ **Advanced Code Analysis**

- **Tree-sitter Parsing**: Robust, syntax-aware code analysis
- **Control Flow Analysis**: Accurately represents loops, conditionals, and branches
- **Cyclomatic Complexity Analysis**: Real-time complexity metrics with visual indicators
- **Higher-Order Functions**: Special support for functional programming patterns
- **Performance Optimized**: Efficient parsing with object pooling and caching

### 📊 **Cyclomatic Complexity Analysis**

- **Function-Level Metrics**: Shows overall function complexity with detailed descriptions
- **Node-Level Indicators**: Visual complexity indicators (⚠️ 🔴 🚨) on flowchart nodes
- **Configurable Thresholds**: Customizable complexity ratings (Low/Medium/High/Very High)
- **Toggle Display**: 📊 button to show/hide complexity information
- **Smart Analysis**: Follows McCabe's cyclomatic complexity calculation
- **Multi-Language Support**: Works across Python, TypeScript, Java, and C++

## 🚀 Quick Start

1. **Install** the Visor extension from the VS Code marketplace
2. **Open** any Python, TypeScript, Java, or C++ file
3. **Click** the Visor icon in the Activity Bar (left sidebar)
4. **Place your cursor** inside a function to see the flowchart
5. **Observe complexity metrics** in the bottom panel and node indicators

**Try this Python example:**
```python
def complex_function(data):
    result = 0
    for item in data:
        if item > 10:
            if item % 2 == 0:
                result += item * 2
            else:
                result += item
        elif item > 0:
            result += 1
    return result
```
This function will show **Medium complexity (CC=6)** with ⚠️ indicators on decision nodes.

## � Enhanced Node Readability

### Semantic Node Categories

Visor now provides enhanced visual differentiation through semantic node categorization:

- **Entry/Exit Nodes** (Round with double borders): Function start and end points
- **Decision Nodes** (Diamond with dashed borders): Conditionals, loops, and branching logic
- **Process Nodes** (Rectangle with solid borders): Regular statements and assignments
- **Loop Control** (Stadium): Loop end markers and control flow
- **Exception Handling** (Stadium with dotted borders): Try/catch/finally blocks
- **Assignment Nodes** (Rectangle): Variable assignments and declarations
- **Function Calls** (Rectangle): External function invocations
- **Return Nodes** (Stadium): Function return statements
- **Break/Continue** (Rectangle with dashed borders): Control flow interruption

### Subtle Visual Enhancement

The design maintains professionalism while improving comprehension through:

- **Theme-Aware Colors**: Subtle accent colors that respect VS Code's theme preferences
- **Enhanced Typography**: Improved font weights and sizing for better legibility
- **Smart Hover Effects**: Gentle visual feedback without overwhelming the interface
- **Consistent Visual Hierarchy**: Different node types use consistent visual patterns
- **Accessibility**: High contrast support and reduced motion options
- **Complexity Indicators**: Visual markers (⚠️ 🔴 🚨) on nodes with high cyclomatic complexity

### Configuration

Access theme and complexity settings via VS Code Settings (`Cmd/Ctrl + ,`) under "Visor":

```json
{
  "visor.nodeReadability.theme": "monokai",
  "visor.complexity.enabled": true,
  "visor.complexity.displayInNodes": true,
  "visor.complexity.displayInPanel": true,
  "visor.complexity.thresholds.low": 5,
  "visor.complexity.thresholds.medium": 10,
  "visor.complexity.thresholds.high": 20
}
```

## �🚀 How to Use

### Getting Started

1. **Install the Extension**: Search for "Visor" in the VS Code Extensions marketplace
2. **Open a Supported File**: Open any Python, TypeScript, JavaScript, Java, or C/C++ file
3. **Access the Flowchart**: Click the Visor icon in the Activity Bar (left sidebar)

### Navigation & Interaction

1. **Function Selection**: Place your cursor inside any function - the flowchart updates automatically
2. **Code Navigation**: Click any node in the flowchart to jump to the corresponding code
3. **Live Highlighting**: Move your cursor through the code to see real-time highlighting in the flowchart
4. **Export**: Use the export buttons (top-right of flowchart) to save as SVG or PNG
5. **Complexity Analysis**: View function complexity in the bottom panel and node indicators

### Understanding Complexity Metrics

Visor provides cyclomatic complexity analysis to help you write maintainable code:

- **Bottom Panel**: Shows overall function complexity with detailed description
- **Visual Indicators**: Emoji markers on complex nodes (⚠️ Medium, 🔴 High, 🚨 Very High)
- **Toggle Button**: Use the 📊 button (bottom-right) to show/hide complexity information
- **Thresholds**: Default ranges are 1-5 (Low), 6-10 (Medium), 11-20 (High), 21+ (Very High)

**Example**: A function with many nested if-statements and loops will show:
- High complexity rating in the panel
- Red indicators 🔴 on decision nodes
- Suggestion to consider refactoring

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

- **AbstractParser**: Enhanced base class with semantic node creation and complexity analysis
- **ComplexityAnalyzer**: McCabe cyclomatic complexity calculation engine with language-specific support
- **ComplexityConfig**: Configuration management for complexity thresholds, indicators, and display options
- **Language Services**: Specialized parsers for each supported language with semantic node type assignment
- **FlowchartIR**: Enhanced intermediate representation with semantic node categorization and complexity metrics
- **EnhancedMermaidGenerator**: Advanced generator with theme-aware styling, visual enhancement, and complexity indicators
- **SubtleThemeManager**: Professional color palette management for enhanced readability
- **FlowchartViewProvider**: VS Code webview integration with enhanced CSS, interactions, and complexity display

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
│   └── FlowchartViewProvider.ts  # Main webview provider with complexity display
├── logic/
│   ├── analyzer.ts           # Language router
│   ├── EnhancedMermaidGenerator.ts  # Advanced flowchart generation with complexity indicators
│   ├── language-services/   # Language-specific parsers
│   │   ├── python/
│   │   ├── typescript/
│   │   ├── java/
│   │   └── cpp/
│   ├── common/
│   │   ├── AbstractParser.ts    # Base parser class with complexity analysis
│   │   └── AstParserTypes.ts    # Shared types
│   └── utils/
│       ├── StringProcessor.ts   # String utilities
│       ├── ComplexityAnalyzer.ts # McCabe complexity calculation
│       ├── ComplexityConfig.ts   # Configuration management
│       └── ThemeManager.ts      # Theme and styling management
├── ir/
│   └── ir.ts                # Intermediate representation with complexity metrics
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
- **Conditional**: if/else, switch/case, ternary operators (+1 complexity each)
- **Loops**: for, while, do-while loops (+1 complexity each)
- **Jump Statements**: break, continue, return
- **Exception Handling**: try/catch blocks (+1 complexity per catch)
- **Logical Operators**: AND/OR operations (+1 complexity each)

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
- **McCabe**: For foundational work on cyclomatic complexity metrics

---

# Code with <❤️> Visor
