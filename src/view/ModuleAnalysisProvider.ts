import * as vscode from "vscode";
import { ModuleAnalyzer } from "../logic/ModuleAnalyzer";
import { ModuleMermaidGenerator } from "../logic/ModuleMermaidGenerator";
import { ModuleAnalysisIR } from "../ir/moduleIr";

export class ModuleAnalysisProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "visor.moduleAnalysisView";
  
  private _view?: vscode.WebviewView;
  private _analyzer: ModuleAnalyzer;
  private _generator: ModuleMermaidGenerator;
  private _currentAnalysis?: ModuleAnalysisIR;

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._analyzer = new ModuleAnalyzer();
    this._generator = new ModuleMermaidGenerator();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    this._updateWebview();

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case 'refresh':
          this._refreshAnalysis();
          break;
        case 'analyzeWorkspace':
          this.analyzeWorkspace();
          break;
        case 'analyzeCurrentFile':
          this.analyzeCurrentFileContext();
          break;
        case 'changeView':
          this._changeView(message.viewType);
          break;
        case 'exportSVG':
          this._exportSVG();
          break;
        case 'exportPNG':
          this._exportPNG();
          break;
      }
    });
  }

  public async analyzeWorkspace(): Promise<void> {
    if (!this._view) return;

    try {
      this._showLoading("Analyzing workspace modules...");
      this._currentAnalysis = await this._analyzer.analyzeWorkspace();
      this._updateWebview();
    } catch (error) {
      this._showError(`Failed to analyze workspace: ${error}`);
    }
  }

  public async analyzeCurrentFileContext(): Promise<void> {
    if (!this._view) return;

    try {
      this._showLoading("Analyzing current file context...");
      this._currentAnalysis = await this._analyzer.analyzeActiveFileContext();
      this._updateWebview();
    } catch (error) {
      this._showError(`Failed to analyze current file context: ${error}`);
    }
  }

  private async _refreshAnalysis(): Promise<void> {
    if (this._currentAnalysis) {
      // Re-run the same type of analysis
      if (this._currentAnalysis.rootModule) {
        await this.analyzeCurrentFileContext();
      } else {
        await this.analyzeWorkspace();
      }
    }
  }

  private _changeView(viewType: 'dependency' | 'overview' | 'matrix'): void {
    if (!this._currentAnalysis) return;
    
    this._updateWebview(viewType);
  }

  private _updateWebview(viewType: 'dependency' | 'overview' | 'matrix' = 'dependency'): void {
    if (!this._view) return;

    if (!this._currentAnalysis) {
      this._view.webview.html = this._getInitialHtml();
      return;
    }

    let mermaidGraph: string;
    let viewTitle: string;

    switch (viewType) {
      case 'overview':
        mermaidGraph = this._generator.generateModuleOverview(this._currentAnalysis);
        viewTitle = "Module Overview";
        break;
      case 'matrix':
        mermaidGraph = this._generator.generateDependencyMatrix(this._currentAnalysis);
        viewTitle = "Dependency Matrix";
        break;
      default:
        mermaidGraph = this._generator.generateModuleGraph(this._currentAnalysis);
        viewTitle = "Module Dependencies";
    }

    this._view.webview.html = this._getWebviewHtml(mermaidGraph, viewTitle, viewType);
  }

  private _showLoading(message: string): void {
    if (!this._view) return;
    
    this._view.webview.html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Module Analysis</title>
        <style>
          body { 
            font-family: var(--vscode-font-family); 
            color: var(--vscode-foreground);
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
          }
          .loading {
            text-align: center;
          }
          .spinner {
            border: 2px solid var(--vscode-progressBar-background);
            border-top: 2px solid var(--vscode-progressBar-foreground);
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            margin: 0 auto 10px;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="loading">
          <div class="spinner"></div>
          <p>${message}</p>
        </div>
      </body>
      </html>
    `;
  }

  private _showError(message: string): void {
    if (!this._view) return;
    
    this._view.webview.html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Module Analysis</title>
        <style>
          body { 
            font-family: var(--vscode-font-family); 
            color: var(--vscode-errorForeground);
            padding: 20px;
          }
          .error { text-align: center; }
          button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            margin: 10px 5px;
            border-radius: 4px;
            cursor: pointer;
          }
          button:hover {
            background: var(--vscode-button-hoverBackground);
          }
        </style>
      </head>
      <body>
        <div class="error">
          <h3>❌ Analysis Failed</h3>
          <p>${message}</p>
          <button onclick="analyzeWorkspace()">Analyze Workspace</button>
          <button onclick="analyzeCurrentFile()">Analyze Current File</button>
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          function analyzeWorkspace() {
            vscode.postMessage({ command: 'analyzeWorkspace' });
          }
          function analyzeCurrentFile() {
            vscode.postMessage({ command: 'analyzeCurrentFile' });
          }
        </script>
      </body>
      </html>
    `;
  }

  private _getInitialHtml(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Module Analysis</title>
        <style>
          body { 
            font-family: var(--vscode-font-family); 
            color: var(--vscode-foreground);
            padding: 20px;
            text-align: center;
          }
          .welcome {
            margin: 20px 0;
          }
          .icon {
            font-size: 48px;
            margin: 20px 0;
          }
          button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 12px 24px;
            margin: 10px 5px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
          }
          button:hover {
            background: var(--vscode-button-hoverBackground);
          }
          .description {
            margin: 20px 0;
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
            line-height: 1.4;
          }
        </style>
      </head>
      <body>
        <div class="welcome">
          <div class="icon">🏗️</div>
          <h2>Module Analysis</h2>
          <p class="description">
            Get a 30,000 ft view of your codebase.<br/>
            Analyze module dependencies, imports, exports, and interactions.
          </p>
          <button onclick="analyzeWorkspace()">🌐 Analyze Workspace</button>
          <button onclick="analyzeCurrentFile()">📄 Analyze Current File</button>
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          function analyzeWorkspace() {
            vscode.postMessage({ command: 'analyzeWorkspace' });
          }
          function analyzeCurrentFile() {
            vscode.postMessage({ command: 'analyzeCurrentFile' });
          }
        </script>
      </body>
      </html>
    `;
  }

  private _getWebviewHtml(mermaidGraph: string, title: string, currentView: string): string {
    const analysis = this._currentAnalysis!;
    const moduleCount = analysis.modules.length;
    const dependencyCount = analysis.dependencies.length;

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Module Analysis</title>
        <script src="https://cdn.jsdelivr.net/npm/mermaid@10.6.1/dist/mermaid.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/svg-pan-zoom@3.6.1/dist/svg-pan-zoom.min.js"></script>
        <style>
          body { 
            font-family: var(--vscode-font-family); 
            margin: 0;
            padding: 10px;
            background: var(--vscode-editor-background);
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding: 10px;
            background: var(--vscode-titleBar-activeBackground);
            border-radius: 4px;
          }
          .title {
            color: var(--vscode-titleBar-activeForeground);
            font-weight: bold;
            font-size: 16px;
          }
          .controls {
            display: flex;
            gap: 5px;
          }
          button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
          }
          button:hover {
            background: var(--vscode-button-hoverBackground);
          }
          button.active {
            background: var(--vscode-button-hoverBackground);
            font-weight: bold;
          }
          .stats {
            display: flex;
            gap: 15px;
            margin: 10px 0;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
          }
          .stat {
            display: flex;
            align-items: center;
            gap: 5px;
          }
          #mermaid-container {
            width: 100%;
            height: 70vh;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            overflow: hidden;
            background: white;
          }
          .mermaid {
            width: 100%;
            height: 100%;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="title">${title}</div>
            <div class="stats">
              <div class="stat">📁 <span>${moduleCount} modules</span></div>
              <div class="stat">🔗 <span>${dependencyCount} dependencies</span></div>
            </div>
          </div>
          <div class="controls">
            <button onclick="changeView('dependency')" ${currentView === 'dependency' ? 'class="active"' : ''}>Dependencies</button>
            <button onclick="changeView('overview')" ${currentView === 'overview' ? 'class="active"' : ''}>Overview</button>
            <button onclick="changeView('matrix')" ${currentView === 'matrix' ? 'class="active"' : ''}>Matrix</button>
            <button onclick="refresh()">🔄</button>
            <button onclick="exportSVG()">📥 SVG</button>
          </div>
        </div>
        
        <div id="mermaid-container">
          <div class="mermaid">
${mermaidGraph}
          </div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          let panZoom;

          mermaid.initialize({ 
            startOnLoad: true,
            theme: 'default',
            securityLevel: 'loose',
            flowchart: {
              useMaxWidth: true,
              htmlLabels: true
            }
          });

          mermaid.init(undefined, ".mermaid").then(() => {
            // Add pan and zoom after mermaid renders
            setTimeout(() => {
              const svgElement = document.querySelector('#mermaid-container svg');
              if (svgElement && !panZoom) {
                panZoom = svgPanZoom(svgElement, {
                  zoomEnabled: true,
                  controlIconsEnabled: true,
                  fit: true,
                  center: true,
                  minZoom: 0.1,
                  maxZoom: 10
                });
              }
            }, 100);
          });

          function refresh() {
            vscode.postMessage({ command: 'refresh' });
          }

          function changeView(viewType) {
            vscode.postMessage({ command: 'changeView', viewType });
          }

          function exportSVG() {
            vscode.postMessage({ command: 'exportSVG' });
          }

          // Handle window resize
          window.addEventListener('resize', () => {
            if (panZoom) {
              panZoom.resize();
              panZoom.fit();
              panZoom.center();
            }
          });
        </script>
      </body>
      </html>
    `;
  }

  private async _exportSVG(): Promise<void> {
    // Implementation for SVG export would go here
    // For now, just show a message
    vscode.window.showInformationMessage("SVG export functionality will be implemented in a future update.");
  }

  private async _exportPNG(): Promise<void> {
    // Implementation for PNG export would go here
    // For now, just show a message  
    vscode.window.showInformationMessage("PNG export functionality will be implemented in a future update.");
  }
}