# Visor: Multi-Language Code-to-Flowchart Visualization

**Visor** is a powerful VS Code extension that provides real-time, interactive flowchart visualization for your code across multiple programming languages. Transform complex code logic into clear, visual flowcharts that help you understand, debug, and document your code more effectively.

## Features

### **Real-Time Flowchart Generation**

- Automatically generates flowcharts for functions as you navigate your code
- Live updates as you edit your code (500ms debounced for optimal performance)
- Intelligent function detection based on cursor position

### **Multi-Language Support**

- **Python**: Functions, lambdas, higher-order functions (map, filter, reduce)
- **TypeScript/JavaScript**: Functions, arrow functions, methods, classes
- **Java**: Methods, classes, constructors
- **C++**: Functions and methods
- **C**: Functions with comprehensive control flow support (if/else, loops, switch, goto)
- **Rust**: Functions, closures, match expressions, if/else, loops (for, while, loop), break/continue

### **Interactive Visualization**

- **Bidirectional Navigation**: Click flowchart nodes to jump to code, cursor movement highlights corresponding nodes
- **Smart Highlighting**: Real-time synchronization between code and flowchart
- **Context-Aware**: Automatically detects the current function scope
- **External Window Support**: Open flowcharts in dedicated panel windows for multi-monitor setups
- **Window State Management**: Robust event handling ensures graphs generate reliably across window switches

### **Rich Visual Elements**

- **Semantic Node Types**: Enhanced visual differentiation between entry/exit, decisions, processes, loops, exceptions, and assignments
- **Subtle Theme-Aware Styling**: Professional color palette that adapts to VS Code light/dark themes without overwhelming visual noise
- **Enhanced Typography**: Improved font weights and sizing for better text readability
- **Smart Border Patterns**: Dashed borders for decisions, double borders for entry/exit, dotted for exceptions
- **Interactive Enhancements**: Smooth hover effects and subtle drop shadows for better user experience
- **Mermaid.js Powered**: High-quality, theme-aware diagrams with enhanced semantic styling
- **Pan & Zoom**: Navigate complex flowcharts with smooth controls
- **VS Code Theme Integration**: Automatically adapts to light/dark themes with subtle accent colors
- **Dual View Options**: Choose between sidebar integration or dedicated external windows

### **Export Capabilities**

- Export flowcharts as **SVG** (vector graphics) or **PNG** (raster images)
- High-quality exports with proper background and styling
- Perfect for documentation and presentations

### **Advanced Code Analysis**

- **Tree-sitter Parsing**: Robust, syntax-aware code analysis
- **Control Flow Analysis**: Accurately represents loops, conditionals, and branches
- **Cyclomatic Complexity Analysis**: Real-time complexity metrics with visual indicators
- **Higher-Order Functions**: Special support for functional programming patterns
- **Performance Optimized**: Efficient parsing with object pooling and caching

### **Cyclomatic Complexity Analysis**

- **Function-Level Metrics**: Shows overall function complexity with detailed descriptions
- **Node-Level Indicators**: Visual complexity indicators (⚠️ 🔴 🚨) on flowchart nodes
- **Configurable Thresholds**: Customizable complexity ratings (Low/Medium/High/Very High)
- **Toggle Display**: 📊 button to show/hide complexity information
- **Smart Analysis**: Follows McCabe's cyclomatic complexity calculation
- **Multi-Language Support**: Works across Python, TypeScript, Java, C++, C, and Rust

## Quick Start

1. **Install** the Visor extension from the VS Code marketplace
2. **Open** any Python, TypeScript, Java, C, or C++ file
3. **Click** the Visor icon in the Activity Bar (left sidebar)
4. **Place your cursor** inside a function to see the flowchart
5. **Observe complexity metrics** in the bottom panel and node indicators
6. **Export** flowcharts as SVG or PNG using the export buttons
7. **Open in External Window**: Click the 🚀 button to view in a dedicated window for larger flowcharts

## Enhanced Node Readability

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

## How to Use

### Getting Started

1. **Install the Extension**: Search for "Visor" in the VS Code Extensions marketplace
2. **Open a Supported File**: Open any Python, TypeScript, JavaScript, Java, C, or C++ file
3. **Access the Flowchart**:
   - **Sidebar View**: Click the Visor icon in the Activity Bar (left sidebar)
   - **External Window**: Use the command palette (`Cmd/Ctrl + Shift + P`) and run "Visor: Generate Flowchart" or click the 🚀 "Open in New Window" button

### Navigation & Interaction

1. **Function Selection**: Place your cursor inside any function - the flowchart updates automatically
2. **Code Navigation**: Click any node in the flowchart to jump to the corresponding code
3. **Live Highlighting**: Move your cursor through the code to see real-time highlighting in the flowchart
4. **Window Management**:
   - **Switch to External**: Click the 🚀 button in the sidebar view to open in a dedicated window
   - **Multi-Monitor Support**: Drag external windows to secondary monitors for enhanced workflow
   - **Automatic Updates**: External windows stay synchronized with your code changes
5. **Export**: Use the export buttons to save as SVG or PNG (available in both views)
6. **Complexity Analysis**: View function complexity in the bottom panel and node indicators

### Understanding Complexity Metrics

Visor provides cyclomatic complexity analysis to help you write maintainable code:

- **Bottom Panel**: Shows overall function complexity with detailed description
- **Visual Indicators**: Emoji markers on complex nodes (⚠️ Medium, 🔴 High, 🚨 Very High)
- **Toggle Button**: Use the 📊 button (bottom-right) to show/hide complexity information
- **Thresholds**: Default ranges are 1-5 (Low), 6-10 (Medium), 11-20 (High), 21+ (Very High)
- **Multi-Window Support**: Complexity information is available in both sidebar and external window views

### Working with External Windows

Visor supports opening flowcharts in dedicated external windows for enhanced productivity:

**Benefits:**

- **Multi-Monitor Workflows**: Place flowchart on secondary monitor while coding on primary
- **Larger View Area**: More space for complex flowcharts without sacrificing code editor space
- **Independent Navigation**: Pan and zoom without affecting your code editor
- **Persistent State**: Windows remember their position and zoom level

**Usage:**

1. **From Sidebar**: Click the 🚀 "Open in New Window" button in the sidebar view
2. **From Command Palette**: Run "Visor: Generate Flowchart" (`Cmd/Ctrl + Shift + P`)
3. **Automatic Sync**: External windows automatically update when you navigate to different functions
4. **Reliable Updates**: Enhanced event handling ensures flowcharts generate consistently across window switches

**Features in External Windows:**

- Full pan and zoom controls
- Export functionality (SVG/PNG)
- Complexity metrics display
- Real-time code synchronization
- Professional panel header with function information

**Example**: A function with many nested if-statements and loops will show:

- High complexity rating in the panel
- Red indicators 🔴 on decision nodes
- Suggestion to consider refactoring

## Technical Architecture

### Core Components

- **AbstractParser**: Enhanced base class with semantic node creation and complexity analysis
- **ComplexityAnalyzer**: McCabe cyclomatic complexity calculation engine with language-specific support
- **ComplexityConfig**: Configuration management for complexity thresholds, indicators, and display options
- **Language Services**: Specialized parsers for each supported language with semantic node type assignment
- **FlowchartIR**: Enhanced intermediate representation with semantic node categorization and complexity metrics
- **EnhancedMermaidGenerator**: Advanced generator with theme-aware styling, visual enhancement, and complexity indicators
- **SubtleThemeManager**: Professional color palette management for enhanced readability
- **BaseFlowchartProvider**: Shared webview logic with robust event handling and window state management
- **FlowchartViewProvider**: Sidebar integration with complexity display and external window launcher
- **FlowchartPanelProvider**: Dedicated external window management with singleton pattern and proper cleanup

### Performance Features

- **Object Pooling**: Reduces garbage collection overhead
- **String Caching**: Optimized string processing with LRU cache
- **Debounced Updates**: Prevents excessive re-rendering during typing
- **Tree-sitter WASM**: Fast, incremental parsing

## Development

### Prerequisites

- Node.js (v16 or higher)
- Yarn package manager
- VS Code (v1.102.0+)

### Setup

```bash
# Clone the repository
git clone https://github.com/sidhant-sriv/visor.git
cd visor

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

### Scripts

- `yarn compile`: Compiles TypeScript to JavaScript
- `yarn watch`: Compiles in watch mode for development

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

### Debug Mode

Enable debug logging by setting the `visor.debug` configuration in VS Code settings.

## Supported Control Structures

- **Sequential**: Statements, assignments, function calls
- **Conditional**: if/else, switch/case, ternary operators (+1 complexity each)
- **Loops**: for, while, do-while loops (+1 complexity each)
- **Jump Statements**: break, continue, return
- **Exception Handling**: try/catch blocks (+1 complexity per catch)
- **Logical Operators**: AND/OR operations (+1 complexity each)

## Privacy & Security

Visor processes your code locally within VS Code. No code is transmitted to external servers. All parsing and flowchart generation happens on your machine, ensuring your code remains private and secure.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- **Tree-sitter**: For robust, incremental parsing
- **Mermaid.js**: For beautiful diagram rendering
- **VS Code API**: For seamless editor integration
- **svg-pan-zoom**: For interactive flowchart navigation
- **McCabe**: For foundational work on cyclomatic complexity metrics

---


## Support

If you find this project useful, consider supporting us on [Buy Me a Coffee](https://buymeacoffee.com/sidsodsud).

# Code with <❤️> Visor