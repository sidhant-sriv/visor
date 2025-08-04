import * as vscode from "vscode";
import * as path from "path";
import { SubtleThemeManager } from "../logic/utils/ThemeManager";
import {
  BaseFlowchartProvider,
  FlowchartViewContext,
  WebviewMessage,
} from "./BaseFlowchartProvider";

export class FlowchartViewProvider
  extends BaseFlowchartProvider
  implements vscode.WebviewViewProvider
{
  public static readonly viewType = "visor.flowchartView";
  private _view?: vscode.WebviewView;

  /**
   * Get available themes for configuration UI
   */
  public static getAvailableThemes() {
    return SubtleThemeManager.getAvailableThemes();
  }

  constructor(extensionUri: vscode.Uri) {
    super(extensionUri);
  }

  protected getWebview(): vscode.Webview | undefined {
    return this._view?.webview;
  }

  protected setWebviewHtml(html: string): void {
    if (this._view) {
      this._view.webview.html = html;
    }
  }

  protected getViewContext(): FlowchartViewContext {
    return {
      isPanel: false,
      showPanelButton: true,
    };
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    // Set up event listeners (will only set up once due to the flag)
    this.setupEventListeners();

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleWebviewMessage(message),
      null,
      this._disposables
    );

    // Initial update
    this.updateView(vscode.window.activeTextEditor);
  }

  /**
   * Public method to refresh the sidebar content
   */
  public refresh(): void {
    if (this._view) {
      this.forceUpdateView(vscode.window.activeTextEditor);
    }
  }

  /**
   * Override dispose to handle view cleanup
   */
  public dispose(): void {
    this._view = undefined;
    super.dispose();
  }
}
