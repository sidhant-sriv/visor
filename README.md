# SidVis - Code-to-Flowchart VS Code Extension

SidVis is a VS Code extension that converts selected Python or TypeScript code into interactive flowcharts for better code visualization and understanding.

## Features

- **TypeScript/JavaScript Support**: Converts TypeScript and JavaScript functions, methods, and code blocks into flowcharts
- **Python Support**: Analyzes Python code using AST parsing to generate flowcharts
- **Interactive Flowcharts**: Displays flowcharts in a side panel using Mermaid.js
- **Real-time Updates**: Automatically updates flowcharts when you modify selected code
- **Context Menu Integration**: Right-click on selected code to generate flowcharts
- **VS Code Theme Integration**: Flowcharts adapt to your VS Code theme

## Installation

1. Install the extension from the VS Code marketplace
2. For Python support, ensure Python 3.8+ is installed on your system
3. Restart VS Code

## Usage

### Basic Usage

1. Open a TypeScript, JavaScript, or Python file
2. Select the code you want to visualize (function, method, or code block)
3. Right-click and select "Generate Flowchart" from the context menu
4. Or use the Command Palette (Ctrl+Shift+P) and search for "Generate Flowchart"

### Supported Code Structures

#### TypeScript/JavaScript
- Function declarations and expressions
- If/else statements
- For loops, while loops, do-while loops
- Return statements
- Variable assignments
- Method calls and expressions

#### Python
- Function definitions
- If/elif/else statements
- For loops and while loops
- Return statements
- Variable assignments
- List comprehensions (basic support)

### Example

For the following TypeScript function:

```typescript
function processOrder(order: any) {
    if (!order || !order.items) {
        throw new Error('Invalid order');
    }
    
    let total = 0;
    for (const item of order.items) {
        total += item.price * item.quantity;
    }
    
    if (total > 100) {
        return applyDiscount(total, 0.1);
    } else {
        return total;
    }
}
```

SidVis will generate a flowchart showing:
- Start node
- Order validation decision
- Loop for calculating total
- Discount application decision
- Return paths

## Flowchart Elements

- **Start/End**: Circular nodes indicating function entry/exit points
- **Process**: Rectangular nodes for variable assignments and expressions
- **Decision**: Diamond-shaped nodes for if/else conditions
- **Loop**: Rectangular nodes with loop-back arrows for iterations

## Configuration

Currently, SidVis uses default settings. Future versions will include:
- Theme customization
- Flowchart layout options
- Export functionality

## Requirements

- VS Code 1.102.0 or higher
- For Python support: Python 3.8+
- For TypeScript/JavaScript: Built-in support (no additional requirements)

## Extension Settings

This extension contributes the following settings:

- Currently no user settings (future versions will include customization options)

## Known Issues

- Large code blocks may generate complex flowcharts that are difficult to read
- Python analysis requires Python to be installed and accessible in PATH
- Some complex control structures may not be fully represented

## Development

To contribute to SidVis:

1. Clone the repository
2. Install dependencies: `yarn install`
3. Open in VS Code and press F5 to run the extension in debug mode
4. Make changes and test with the provided sample files

### Building

```bash
yarn compile
```

### Testing

```bash
yarn test
```

## Release Notes

### 0.0.1

- Initial release
- Basic TypeScript/JavaScript flowchart generation
- Python AST-based analysis
- Mermaid.js integration
- Context menu and command palette support

## Roadmap

- [ ] Enhanced Python support (decorators, async/await, etc.)
- [ ] Export flowcharts as images
- [ ] Flowchart customization options
- [ ] Support for more programming languages
- [ ] Better error handling and user feedback
- [ ] Performance optimizations for large files

## Contributing

Issues and pull requests are welcome! Please see the repository for contribution guidelines.

## License

This extension is released under the MIT License.
