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
}

/**
 * This function is called when the extension is deactivated.
 */
export function deactivate() {}
