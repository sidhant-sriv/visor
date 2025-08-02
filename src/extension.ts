import * as vscode from "vscode";
import { FlowchartViewProvider } from "./view/FlowchartViewProvider";
import { initLanguageServices } from "./logic/language-services";

export async function activate(context: vscode.ExtensionContext) {
  console.log("Visor extension is now active!");

  try {
    // Initialize all language services
    await initLanguageServices(context);
    console.log("All language parsers initialized successfully.");
  } catch (error) {
    console.error("Failed to initialize language parsers:", error);
    vscode.window.showErrorMessage(
      "Visor: Failed to load language parsers. Flowchart generation may not be available."
    );
  }

  const provider = new FlowchartViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      FlowchartViewProvider.viewType,
      provider
    )
  );

  // Register the toggle syntax highlighting command
  const toggleSyntaxHighlightingCommand = vscode.commands.registerCommand(
    "visor.toggleSyntaxHighlighting",
    () => {
      const config = vscode.workspace.getConfiguration("visor");
      const currentValue = config.get("syntaxHighlighting.enabled", false);
      config.update(
        "syntaxHighlighting.enabled",
        !currentValue,
        vscode.ConfigurationTarget.Workspace
      );

      const message = currentValue
        ? "Syntax highlighting disabled in flowchart nodes"
        : "Syntax highlighting enabled in flowchart nodes";
      vscode.window.showInformationMessage(message);
    }
  );

  context.subscriptions.push(toggleSyntaxHighlightingCommand);
}

export function deactivate() {}
