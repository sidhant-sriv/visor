import * as vscode from "vscode";
import { EnvironmentDetector } from "../logic/utils/EnvironmentDetector";
import {
  BaseFlowchartProvider,
  WebviewMessage,
  FlowchartViewContext,
} from "./BaseFlowchartProvider";

/**
 * Provider for flowchart panels (separate windows/tabs)
 */
export class FlowchartPanelProvider extends BaseFlowchartProvider {
  private _panel?: vscode.WebviewPanel;
  private static _instance?: FlowchartPanelProvider;

  /**
   * Get the singleton instance of the panel provider
   */
  public static getInstance(extensionUri: vscode.Uri): FlowchartPanelProvider {
    if (!FlowchartPanelProvider._instance) {
      FlowchartPanelProvider._instance = new FlowchartPanelProvider(
        extensionUri
      );
    }
    return FlowchartPanelProvider._instance;
  }

  /**
   * Reset the singleton instance (used for cleanup)
   */
  public static reset(): void {
    if (FlowchartPanelProvider._instance) {
      FlowchartPanelProvider._instance.dispose();
      FlowchartPanelProvider._instance = undefined;
    }
  }

  protected getWebview(): vscode.Webview | undefined {
    return this._panel?.webview;
  }

  protected setWebviewHtml(html: string): void {
    if (this._panel) {
      this._panel.webview.html = html;
    }
  }

  protected getViewContext(): FlowchartViewContext {
    return {
      isPanel: true,
      showPanelButton: false,
    };
  }

  /**
   * Create or show the flowchart panel with enhanced detached window experience
   */
  public createOrShow(
    viewColumn?: vscode.ViewColumn,
    moveToNewWindow: boolean = false
  ): void {
    // If panel already exists, just reveal it and update if needed
    if (this._panel) {
      this._panel.reveal(viewColumn);
      if (moveToNewWindow) {
        this.moveToNewWindow();
      }
      // Force an update to ensure the panel shows current content
      this.forceUpdateView(vscode.window.activeTextEditor);
      return;
    }

    // Get configuration for panel settings
    const config = vscode.workspace.getConfiguration("visor");
    const defaultPosition = config.get<string>("panel.defaultPosition", "two");
    const retainWhenHidden = config.get<boolean>(
      "panel.retainWhenHidden",
      true
    );
    const enableFindWidget = config.get<boolean>(
      "panel.enableFindWidget",
      true
    );

    // Map string position to ViewColumn
    const getViewColumn = (position: string): vscode.ViewColumn => {
      switch (position) {
        case "beside":
          return vscode.ViewColumn.Beside;
        case "three":
          return vscode.ViewColumn.Three;
        case "two":
        default:
          return vscode.ViewColumn.Two;
      }
    };

    const finalViewColumn = viewColumn || getViewColumn(defaultPosition);

    // Create the panel with enhanced options for better detached experience
    const baseOptions = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
      retainContextWhenHidden: retainWhenHidden,
      enableFindWidget: enableFindWidget,
      // Enable command URIs for better interaction
      enableCommandUris: true,
    };
    
    this._panel = vscode.window.createWebviewPanel(
      "visor.flowchartPanel",
      "🔍 Flowchart Viewer", // More distinctive title
      finalViewColumn,
      EnvironmentDetector.getWebviewPanelOptions(baseOptions)
    );

    // Set a distinctive icon to make it stand out
    this._panel.iconPath = {
      light: vscode.Uri.joinPath(this._extensionUri, "media", "icon.png"),
      dark: vscode.Uri.joinPath(this._extensionUri, "media", "icon.png"),
    };

    // Handle panel disposal
    this._panel.onDidDispose(
      () => {
        this._panel = undefined;
        // Reset the singleton instance when panel is disposed
        FlowchartPanelProvider._instance = undefined;
      },
      null,
      this._disposables
    );

    // Handle panel state changes - ensure updates when panel becomes active
    this._panel.onDidChangeViewState(
      (e) => {
        if (e.webviewPanel.active) {
          // Update title and force a view update when panel becomes active
          this.updateTitle();
          // Use setTimeout to ensure proper timing
          setTimeout(() => {
            this.forceUpdateView(vscode.window.activeTextEditor);
          }, 50);
        }
      },
      null,
      this._disposables
    );

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleWebviewMessage(message),
      null,
      this._disposables
    );

    // Set up event listeners
    this.setupEventListeners();

    // Initial update
    this.updateView(vscode.window.activeTextEditor);

    // Move to new window if requested
    if (moveToNewWindow) {
      // Use setTimeout to ensure the panel is fully created before moving
      setTimeout(() => {
        this.moveToNewWindow();
      }, 100);
    }

    // Show a helpful notification
    const message = moveToNewWindow
      ? "📊 Flowchart opened in new window! Use Cmd+W to close or drag to reposition."
      : "📊 Flowchart opened in detachable panel! You can drag this tab to split views or different positions.";

    vscode.window.showInformationMessage(message, "Got it");
  }

  /**
   * Check if the panel is currently visible
   */
  public isVisible(): boolean {
    return this._panel?.visible ?? false;
  }

  /**
   * Move the panel to a new window (attempts to use VS Code's built-in commands)
   */
  private async moveToNewWindow(): Promise<void> {
    if (!this._panel) {
      return;
    }

    try {
      // Try to move the active tab to a new window
      // VS Code has built-in commands for this
      await vscode.commands.executeCommand(
        "workbench.action.moveEditorToNewWindow"
      );
    } catch (error) {
      console.warn("Could not move panel to new window:", error);
      // Fallback: show notification with manual instructions
      vscode.window.showInformationMessage(
        "💡 To move to a separate window: Right-click the tab → 'Move into New Window' or drag the tab out of VS Code",
        "Got it"
      );
    }
  }

  /**
   * Close/hide the sidebar flowchart view to avoid duplication
   */
  public static async closeSidebarView(): Promise<void> {
    try {
      // Close the visor sidebar panel
      await vscode.commands.executeCommand("visor.hideSidebar");
    } catch (error) {
      // If the command doesn't exist, try to close the entire sidebar
      try {
        await vscode.commands.executeCommand("workbench.action.closeSidebar");
      } catch (fallbackError) {
        console.warn("Could not close sidebar:", fallbackError);
      }
    }
  }

  /**
   * Update the panel title based on the current file
   */
  public updateTitle(fileName?: string): void {
    if (this._panel) {
      const title = fileName
        ? `Code Flowchart - ${fileName}`
        : "Code Flowchart";
      this._panel.title = title;
    }
  }

  /**
   * Override updateView to also update the title
   */
  public async updateView(
    editor: vscode.TextEditor | undefined
  ): Promise<void> {
    if (editor) {
      const fileName =
        editor.document.fileName.split("/").pop() ||
        editor.document.fileName.split("\\").pop() ||
        "Untitled";
      this.updateTitle(fileName);
    } else {
      this.updateTitle();
    }

    await super.updateView(editor);
  }

  /**
   * Public method to refresh the panel content (useful for external triggers)
   */
  public refresh(): void {
    if (this._panel) {
      this.forceUpdateView(vscode.window.activeTextEditor);
    }
  }

  /**
   * Dispose of the panel and clean up resources
   */
  public dispose(): void {
    if (this._panel) {
      this._panel.dispose();
      this._panel = undefined;
    }
    super.dispose();
  }
}
