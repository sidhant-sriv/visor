# visor: Real-time Code-to-Flowchart Visualization

visor is a VS Code extension that provides a live, interactive flowchart of your TypeScript or JavaScript code, helping you visualize its structure and flow as you work.

## Features

- **Live Flowchart Generation**: Automatically generates a flowchart for the current function in view.
- **Interactive Visualization**: Click on flowchart nodes to highlight the corresponding code, and as you move your cursor through the code, the corresponding node in the flowchart is highlighted.
- **TypeScript & JavaScript Support**: Analyzes your code to create an accurate visual representation.
- **Seamless Integration**: The flowchart appears in a dedicated view in the activity bar and adapts to your VS Code theme.
- **Pan and Zoom**: The flowchart can be panned and zoomed for better navigation of complex code.

## How to Use

1.  Open a TypeScript or JavaScript file.
2.  Click on the visor icon in the activity bar to open the flowchart view.
3.  As you click into different functions in your editor, the flowchart will automatically update to show the logic of the current function.
4.  Move your cursor within a function to see the corresponding part of the flowchart highlighted.
5.  Click on a node in the flowchart to jump to and highlight that code in the editor.

## Requirements

- Visual Studio Code v1.85.0 or newer.

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
