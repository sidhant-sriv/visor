import * as vscode from "vscode";
import { FlowchartViewProvider } from "./view/FlowchartViewProvider";
import { FlowchartPanelProvider } from "./view/FlowchartPanelProvider";
import { initLanguageServices } from "./logic/language-services";
import { EnvironmentDetector } from "./logic/utils/EnvironmentDetector";

export async function activate(context: vscode.ExtensionContext) {
  console.log("Visor extension is now active!");

  // Detect environment and log compatibility mode
  const env = EnvironmentDetector.detectEnvironment();
  if (env.requiresCompatibilityMode) {
    console.log(`Visor: Running in compatibility mode for ${env.editor}`);
    vscode.window.showInformationMessage(`Visor: Detected ${env.editor} editor - running in compatibility mode`);
  }

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

  // Register sidebar provider
  const sidebarProvider = new FlowchartViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      FlowchartViewProvider.viewType,
      sidebarProvider
    )
  );

  // Register panel commands
  context.subscriptions.push(
    vscode.commands.registerCommand("visor.openFlowchartInPanel", async () => {
      // Close sidebar view to avoid duplication
      await FlowchartPanelProvider.closeSidebarView();

      const panelProvider = FlowchartPanelProvider.getInstance(
        context.extensionUri
      );
      panelProvider.createOrShow(vscode.ViewColumn.Two, true); // Move to new window
    }),

    vscode.commands.registerCommand("visor.openFlowchartToSide", async () => {
      // Close sidebar view to avoid duplication
      await FlowchartPanelProvider.closeSidebarView();

      const panelProvider = FlowchartPanelProvider.getInstance(
        context.extensionUri
      );
      panelProvider.createOrShow(vscode.ViewColumn.Beside, false); // Keep in same window but beside
    }),

    vscode.commands.registerCommand(
      "visor.openFlowchartInNewColumn",
      async () => {
        // Close sidebar view to avoid duplication
        await FlowchartPanelProvider.closeSidebarView();

        const panelProvider = FlowchartPanelProvider.getInstance(
          context.extensionUri
        );
        panelProvider.createOrShow(vscode.ViewColumn.Three, false);
      }
    ),

    vscode.commands.registerCommand(
      "visor.maximizeFlowchartPanel",
      async () => {
        // Close sidebar view to avoid duplication
        await FlowchartPanelProvider.closeSidebarView();

        const panelProvider = FlowchartPanelProvider.getInstance(
          context.extensionUri
        );
        // Open in the active column to effectively "maximize" it
        panelProvider.createOrShow(vscode.ViewColumn.Active, false);
      }
    ),

    // Add a specific command for opening in new window
    vscode.commands.registerCommand(
      "visor.openFlowchartInNewWindow",
      async () => {
        // Close sidebar view to avoid duplication
        await FlowchartPanelProvider.closeSidebarView();

        const panelProvider = FlowchartPanelProvider.getInstance(
          context.extensionUri
        );
        panelProvider.createOrShow(vscode.ViewColumn.Two, true); // Explicitly move to new window
      }
    ),

    vscode.commands.registerCommand("visor.generateFlowchart", () => {
      // Force update both sidebar and panel if they exist
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        sidebarProvider.refresh();

        const panelProvider = FlowchartPanelProvider.getInstance(
          context.extensionUri
        );
        if (panelProvider.isVisible()) {
          panelProvider.refresh();
        }
      }
    })
  );
}

export function deactivate() {
  // Clean up panel provider instance
  FlowchartPanelProvider.reset();
}
