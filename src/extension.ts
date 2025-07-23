import * as vscode from "vscode";
import { FlowchartViewProvider } from "./view/FlowchartViewProvider";

/**
 * The main entry point for the extension. This function is called by VS Code when
 * the extension is activated (e.g., on first command use).
 */
export function activate(context: vscode.ExtensionContext) {
  const provider = new FlowchartViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      FlowchartViewProvider.viewType,
      provider
    )
  );

  // Register the generate flowchart command
  const generateFlowchartCommand = vscode.commands.registerCommand(
    "visor.generateFlowchart",
    () => {
      // Get the active editor
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor found");
        return;
      }

      // Get the selected text or the entire document
      const document = editor.document;
      const selection = editor.selection;
      const text = selection.isEmpty
        ? document.getText()
        : document.getText(selection);

      const position = selection.isEmpty
        ? 0
        : document.offsetAt(selection.start);

      // Update the flowchart view
      provider.updateFlowchart(text, document.languageId, position);

      // Show the visor view
      vscode.commands.executeCommand("visor.flowchartView.focus");
    }
  );

  context.subscriptions.push(generateFlowchartCommand);
}

/**
 * This function is called when the extension is deactivated.
 */
export function deactivate() {}
