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

## Development

To contribute to visor:

1.  Clone the repository.
2.  Install dependencies: `yarn install`.
3.  Open the project in VS Code and press F5 to launch the Extension Development Host.
4.  Open a TypeScript file in the new window to see the extension in action.

### Scripts

- `yarn compile`: Compiles the extension.
- `yarn watch`: Compiles in watch mode.
- `yarn test`: Runs tests.

## License

This extension is licensed under the MIT License.
