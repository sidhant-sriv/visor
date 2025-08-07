import * as vscode from "vscode";
import { DataFlowAnalyzer } from "../logic/DataFlowAnalyzer";
import { DataFlowMermaidGenerator } from "../logic/DataFlowMermaidGenerator";
import { DataFlowAnalysisIR } from "../ir/dataFlowIr";

const MERMAID_VERSION = "11.8.0";
const SVG_PAN_ZOOM_VERSION = "3.6.1";

// Define message types for consistency with function-level analysis
export type ExportMessage = {
  command: "export";
  payload: { fileType: "svg" | "png"; data: string };
};

export type ExportErrorMessage = {
  command: "exportError";
  payload: { error: string };
};

export type CopyMermaidMessage = {
  command: "copyMermaid";
  payload: { code: string };
};

export type ModuleWebviewMessage =
  | ExportMessage
  | ExportErrorMessage
  | CopyMermaidMessage;

export class DataFlowProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "visor.dataFlowView";

  private _view?: vscode.WebviewView;
  private _analyzer: DataFlowAnalyzer;
  private _generator: DataFlowMermaidGenerator;
  private _currentAnalysis?: DataFlowAnalysisIR;
  private _currentView: 'dataflow' | 'callgraph' = 'dataflow';

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._analyzer = new DataFlowAnalyzer();
    this._generator = new DataFlowMermaidGenerator();

    // Listen for configuration changes to update themes (matching BaseFlowchartProvider)
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("visor.nodeReadability.theme")) {
        // Refresh the current view when theme changes
        this._updateWebview();
      }
    });
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

    this._updateWebview();

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case "refresh":
          this._refreshAnalysis();
          break;
        case "analyzeCurrentFunction":
          this.analyzeCurrentFunction();
          break;
        case "analyzeWorkspace":
          this.analyzeWorkspaceDataFlow();
          break;
        case "switchView":
          this.switchView(message.payload.viewType);
          break;
        case "export":
          await this.handleExport(message.payload);
          break;
        case "exportError":
          vscode.window.showErrorMessage(
            `Export failed: ${message.payload.error}`
          );
          break;
        case "copyMermaid":
          await vscode.env.clipboard.writeText(message.payload.code);
          vscode.window.showInformationMessage(
            "Mermaid code copied to clipboard!"
          );
          break;
      }
    });
  }

  public async analyzeCurrentFunction(): Promise<void> {
    if (!this._view) return;

    try {
      this._showLoading("Analyzing current function data flow...");
      console.log("DataFlowProvider: Starting current function analysis...");

      this._currentAnalysis = await this._analyzer.analyzeCurrentFunctionContext();

      console.log("DataFlowProvider: Analysis complete:", {
        functionCount: this._currentAnalysis.functions.length,
        globalVariableCount: this._currentAnalysis.globalStateVariables.length,
        dataFlowEdges: this._currentAnalysis.dataFlowEdges.length,
        rootFunction: this._currentAnalysis.rootFunction,
      });

      this._updateWebview();
    } catch (error) {
      console.error("DataFlowProvider: Current function analysis failed:", error);
      this._showError(
        `Failed to analyze current function: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  public async analyzeWorkspaceDataFlow(): Promise<void> {
    if (!this._view) return;

    try {
      this._showLoading("Analyzing workspace data flow...");
      console.log("DataFlowProvider: Starting workspace data flow analysis...");

      this._currentAnalysis = await this._analyzer.analyzeWorkspaceDataFlow();

      console.log("DataFlowProvider: Workspace analysis complete:", {
        functionCount: this._currentAnalysis.functions.length,
        globalVariableCount: this._currentAnalysis.globalStateVariables.length,
        dataFlowEdges: this._currentAnalysis.dataFlowEdges.length,
      });

      this._updateWebview();
    } catch (error) {
      console.error("DataFlowProvider: Workspace analysis failed:", error);
      this._showError(
        `Failed to analyze workspace data flow: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  public switchView(viewType: 'dataflow' | 'callgraph'): void {
    this._currentView = viewType;
    this._updateWebview();
  }

  private async _refreshAnalysis(): Promise<void> {
    if (this._currentAnalysis) {
      // Re-run the same type of analysis
      if (this._currentAnalysis.scope === 'workspace') {
        await this.analyzeWorkspaceDataFlow();
      } else {
        await this.analyzeCurrentFunction();
      }
    }
  }

  private _updateWebview(): void {
    if (!this._view) return;

    if (!this._currentAnalysis) {
      this._view.webview.html = this._getInitialHtml();
      return;
    }

    try {
      // Use the same theme configuration logic as BaseFlowchartProvider
      const vsCodeTheme =
        vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
          ? "dark"
          : "light";

      // Read the selected theme from user configuration (same as BaseFlowchartProvider)
      const config = vscode.workspace.getConfiguration("visor");
      const selectedTheme = config.get<string>(
        "nodeReadability.theme",
        "monokai"
      );

      // Pass theme configuration to the generator
      this._generator.setTheme(selectedTheme, vsCodeTheme);

      // Generate the appropriate graph based on current view
      let mermaidGraph: string;
      let viewTitle: string;

      if (this._currentView === 'callgraph') {
        mermaidGraph = this._generator.generateFunctionCallGraph(this._currentAnalysis);
        viewTitle = "Function Call Graph";
      } else {
        mermaidGraph = this._generator.generateDataFlowGraph(this._currentAnalysis);
        viewTitle = "Data Flow Analysis";
      }

      // Validate the generated mermaid graph
      if (!mermaidGraph || mermaidGraph.trim().length === 0) {
        this._showError(
          "Failed to generate graph visualization. No valid graph data found."
        );
        return;
      }

      this._view.webview.html = this._getWebviewHtml(
        mermaidGraph,
        viewTitle,
        this._currentView,
        this._getNonce()
      );
    } catch (error) {
      console.error("Error updating module analysis webview:", error);
      this._showError(
        `Failed to update view: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private _showLoading(message: string): void {
    if (!this._view) return;

    this._view.webview.html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Data Flow Analysis</title>
        <style>
          body { 
            background-color: var(--vscode-editor-background);
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
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
        <title>Data Flow Analysis</title>
        <style>
          body { 
            background-color: var(--vscode-editor-background);
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
          }
          .error { 
            text-align: center;
            color: var(--vscode-errorForeground);
          }
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
          <button id="btn-error-workspace">Analyze Workspace</button>
          <button id="btn-error-current">Analyze Current Function</button>
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          
          document.addEventListener('DOMContentLoaded', () => {
            const analyzeWorkspaceBtn = document.getElementById('btn-error-workspace');
            const analyzeCurrentBtn = document.getElementById('btn-error-current');
            
            if (analyzeWorkspaceBtn) {
              analyzeWorkspaceBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'analyzeWorkspace' });
              });
            }
            
            if (analyzeCurrentBtn) {
              analyzeCurrentBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'analyzeCurrentFunction' });
              });
            }
          });
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
        <title>Data Flow Analysis</title>
        <style>
          body { 
            background-color: var(--vscode-editor-background);
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
          }
          .welcome {
            text-align: center;
            padding: 20px;
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
          <div class="icon">🔄</div>
          <h2>Data Flow Analysis</h2>
          <p class="description">
            Understand how global state flows through your functions.<br/>
            Track data dependencies and global variable usage across your codebase.
          </p>
          <button id="btn-analyze-current">🎯 Analyze Current Function</button>
          <button id="btn-analyze-workspace">🌐 Analyze Workspace</button>
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          
          document.addEventListener('DOMContentLoaded', () => {
            const analyzeWorkspaceBtn = document.getElementById('btn-analyze-workspace');
            const analyzeCurrentBtn = document.getElementById('btn-analyze-current');
            
            if (analyzeWorkspaceBtn) {
              analyzeWorkspaceBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'analyzeWorkspace' });
              });
            }
            
            if (analyzeCurrentBtn) {
              analyzeCurrentBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'analyzeCurrentFunction' });
              });
            }
          });
        </script>
      </body>
      </html>
    `;
  }

  private _getWebviewHtml(
    mermaidGraph: string,
    title: string,
    currentView: string,
    nonce: string
  ): string {
    const analysis = this._currentAnalysis!;
    const functionCount = analysis.functions.length;
    const globalVarCount = analysis.globalStateVariables.length;
    const dataFlowCount = analysis.dataFlowEdges.length;

    // Use the same theme logic as BaseFlowchartProvider for consistency
    const theme =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
        ? "dark"
        : "default";

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data:; font-src https://cdn.jsdelivr.net;">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Data Flow Analysis</title>
        <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.min.js"></script>
        <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/svg-pan-zoom@${SVG_PAN_ZOOM_VERSION}/dist/svg-pan-zoom.min.js"></script>
        <style>
          body, html { 
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family);
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
            overflow: hidden;
          }
          
          .container {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
          }
          
          .header {
            flex-shrink: 0;
            padding: 12px 16px;
            background: var(--vscode-editor-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(8px);
          }
          
          .header-info {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          
          .title {
            color: var(--vscode-foreground);
            font-weight: 600;
            font-size: 14px;
            margin: 0;
          }
          
          .stats {
            display: flex;
            gap: 16px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
          }
          
          .stat {
            display: flex;
            align-items: center;
            gap: 4px;
          }
          
          .header-controls {
            display: flex;
            align-items: center;
            gap: 12px;
          }
          
          .view-controls {
            display: flex;
            gap: 4px;
            align-items: center;
          }
          
          .export-controls {
            display: flex;
            gap: 8px;
            align-items: center;
          }
          
          .divider {
            width: 1px;
            height: 20px;
            background: var(--vscode-panel-border);
            opacity: 0.5;
          }
          
          button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: 1px solid var(--vscode-button-border, transparent);
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            font-family: var(--vscode-font-family);
            transition: background-color 0.2s ease;
            display: flex;
            align-items: center;
            gap: 4px;
          }
          
          button:hover {
            background: var(--vscode-button-hoverBackground);
          }
          
          button.active {
            background: var(--vscode-button-hoverBackground);
            font-weight: 600;
          }
          
          button.icon-only {
            padding: 6px 8px;
            min-width: auto;
          }
          
          #mermaid-container {
            flex: 1;
            width: 100%;
            height: calc(100% - 70px);
            border: 1px solid var(--vscode-panel-border);
            border-top: none;
            background: var(--vscode-editor-background);
            overflow: hidden;
            position: relative;
          }
          
          .mermaid {
            width: 100%;
            height: 100%;
          }
          
          .mermaid svg {
            width: 100%;
            height: 100%;
          }
          
          /* Enhanced node styling */
          .mermaid .node {
            filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1));
          }
          
          .mermaid .node text {
            font-family: var(--vscode-font-family);
            font-size: 12px;
            text-anchor: middle;
            dominant-baseline: central;
          }
          
          /* Edge styling for better flow visibility */
          .mermaid .edgePath path {
            stroke-width: 1.5px;
            stroke: var(--vscode-editorWidget-border);
            fill: none;
          }
          
          .mermaid .edgeLabel {
            background-color: transparent;
            border: none;
            border-radius: 0;
            padding: 0;
            font-size: 11px;
            color: var(--vscode-editor-foreground);
            font-weight: normal;
          }
          
          /* Hidden element to store original mermaid source */
          #mermaid-source {
            display: none;
          }
          
          /* Loading and error states */
          .message-container {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            text-align: center;
            padding: 20px;
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
            margin: 0 auto 10px auto;
          }
          
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          
          .error {
            color: var(--vscode-errorForeground);
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="header-info">
              <h3 class="title">${title}</h3>
              <div class="stats">
                <div class="stat">⚙️ <span>${functionCount} functions</span></div>
                <div class="stat">📊 <span>${globalVarCount} global vars</span></div>
                <div class="stat">🔗 <span>${dataFlowCount} data flows</span></div>
              </div>
            </div>
            
            <div class="header-controls">
              <div class="view-controls">
                <button id="btn-dataflow" class="${currentView === 'dataflow' ? 'active' : ''}" title="Data Flow View">📊 Data Flow</button>
                <button id="btn-callgraph" class="${currentView === 'callgraph' ? 'active' : ''}" title="Call Graph View">🔄 Call Graph</button>
              </div>
              
              <div class="divider"></div>
              
              <div class="export-controls">
                <button id="btn-refresh" class="icon-only" title="Refresh analysis">🔄</button>
                <button id="copy-mermaid" title="Copy Mermaid code to clipboard">📋 Copy Code</button>
                <button id="export-svg" title="Export as SVG">💾 SVG</button>
                <button id="export-png" title="Export as PNG">🖼️ PNG</button>
              </div>
            </div>
          </div>
          
          <div id="mermaid-container">
            <div class="mermaid">
${mermaidGraph}
            </div>
          </div>
        </div>

        <!-- Store the original mermaid source for export -->
        <div id="mermaid-source">${mermaidGraph
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</div>

        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();

          // Use the same initialization pattern as BaseFlowchartProvider
          mermaid.initialize({
            startOnLoad: true,
            theme: '${theme}',
            securityLevel: 'loose',
            flowchart: {
              useMaxWidth: false,
              htmlLabels: true,
              curve: 'basis'
            }
          });

          // Initialize pan/zoom after mermaid loads (matching BaseFlowchartProvider pattern)
          window.addEventListener('load', () => {
            const svgElement = document.querySelector('.mermaid svg');
            if (svgElement) {
              const panZoomInstance = svgPanZoom(svgElement, {
                zoomEnabled: true,
                controlIconsEnabled: true,
                fit: true,
                center: true,
                minZoom: 0.1,
                maxZoom: 10,
                zoomScaleSensitivity: 0.2
              });
            }

            // Set up event listeners after DOM is loaded
            setupEventListeners();
          });

          function setupEventListeners() {
            // View switching buttons
            const btnDataFlow = document.getElementById('btn-dataflow');
            const btnCallGraph = document.getElementById('btn-callgraph');
            
            if (btnDataFlow) {
              btnDataFlow.addEventListener('click', () => {
                vscode.postMessage({ 
                  command: 'switchView',
                  payload: { viewType: 'dataflow' }
                });
              });
            }
            
            if (btnCallGraph) {
              btnCallGraph.addEventListener('click', () => {
                vscode.postMessage({ 
                  command: 'switchView',
                  payload: { viewType: 'callgraph' }
                });
              });
            }

            // Refresh button
            const btnRefresh = document.getElementById('btn-refresh');
            if (btnRefresh) {
              btnRefresh.addEventListener('click', () => refresh());
            }

            // Export functionality
            const exportSvgBtn = document.getElementById('export-svg');
            const exportPngBtn = document.getElementById('export-png');
            
            if (exportSvgBtn) {
              exportSvgBtn.addEventListener('click', () => exportFlowchart('svg'));
            }
            if (exportPngBtn) {
              exportPngBtn.addEventListener('click', () => exportFlowchart('png'));
            }

            // Copy functionality
            const copyBtn = document.getElementById('copy-mermaid');
            if (copyBtn) {
              copyBtn.addEventListener('click', () => {
                const mermaidSourceElement = document.getElementById('mermaid-source');
                const mermaidSource = (mermaidSourceElement?.textContent || '').trim();

                if (mermaidSource) {
                  vscode.postMessage({
                    command: 'copyMermaid',
                    payload: { code: mermaidSource }
                  });

                  // Visual feedback
                  const originalText = copyBtn.textContent;
                  copyBtn.textContent = '✅ Copied!';
                  copyBtn.disabled = true;
                  setTimeout(() => {
                    copyBtn.textContent = originalText;
                    copyBtn.disabled = false;
                  }, 2000);
                } else {
                  vscode.postMessage({
                    command: 'exportError',
                    payload: { error: "Could not find Mermaid source code to copy." }
                  });
                }
              });
            }
          }

          // Enhanced export functionality matching function-level analysis
          function exportFlowchart(fileType) {
            const mermaidSourceElement = document.getElementById('mermaid-source');

            if (!mermaidSourceElement || !mermaidSourceElement.innerHTML) {
              vscode.postMessage({
                command: 'exportError',
                payload: { error: "Could not find Mermaid source code to export." }
              });
              return;
            }

            const mermaidSource = mermaidSourceElement.innerHTML
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&amp;/g, '&')
              .trim();

            const exportId = 'export-' + Date.now();

            // Use mermaid.render to get a clean SVG without pan-zoom controls
            mermaid.render(exportId, mermaidSource)
              .then(result => {
                const { svg } = result;
                const parser = new DOMParser();
                const svgDoc = parser.parseFromString(svg, 'image/svg+xml');
                const cleanSvgElement = svgDoc.documentElement;

                if (!cleanSvgElement || cleanSvgElement.tagName !== 'svg') {
                  throw new Error('Invalid SVG generated by Mermaid render');
                }

                // Temporarily add to DOM to calculate size
                const tempDiv = document.createElement('div');
                tempDiv.style.position = 'absolute';
                tempDiv.style.visibility = 'hidden';
                document.body.appendChild(tempDiv);
                tempDiv.appendChild(cleanSvgElement);
                const bbox = cleanSvgElement.getBBox();
                document.body.removeChild(tempDiv);

                const padding = 20;
                const finalX = bbox.x - padding;
                const finalY = bbox.y - padding;
                const finalWidth = bbox.width + (padding * 2);
                const finalHeight = bbox.height + (padding * 2);

                // Set final dimensions and viewBox
                cleanSvgElement.setAttribute('width', finalWidth.toString());
                cleanSvgElement.setAttribute('height', finalHeight.toString());
                cleanSvgElement.setAttribute('viewBox', \`\${finalX} \${finalY} \${finalWidth} \${finalHeight}\`);

                // Add a background rectangle
                const backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-background').trim() || '#ffffff';
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', finalX.toString());
                rect.setAttribute('y', finalY.toString());
                rect.setAttribute('width', finalWidth.toString());
                rect.setAttribute('height', finalHeight.toString());
                rect.setAttribute('fill', backgroundColor);
                cleanSvgElement.insertBefore(rect, cleanSvgElement.firstChild);

                const finalSvgData = new XMLSerializer().serializeToString(cleanSvgElement);

                if (fileType === 'svg') {
                  vscode.postMessage({
                    command: 'export',
                    payload: { fileType: 'svg', data: finalSvgData }
                  });
                } else { // PNG export
                  const canvas = document.createElement('canvas');
                  const ctx = canvas.getContext('2d');
                  if (!ctx) {
                    throw new Error("Could not get canvas 2D context.");
                  }

                  const scale = 2; // For higher DPI
                  canvas.width = finalWidth * scale;
                  canvas.height = finalHeight * scale;
                  ctx.scale(scale, scale);

                  const img = new Image();
                  img.onload = function() {
                    ctx.drawImage(img, 0, 0, finalWidth, finalHeight);
                    const pngData = canvas.toDataURL('image/png').split(',')[1]; // Get base64 part
                    vscode.postMessage({
                      command: 'export',
                      payload: { fileType: 'png', data: pngData }
                    });
                  };
                  img.onerror = function() {
                    vscode.postMessage({
                      command: 'exportError',
                      payload: { error: "SVG to PNG conversion failed (image load error)." }
                    });
                  };
                  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(finalSvgData);
                }
              })
              .catch(error => {
                const errorMessage = error instanceof Error ? error.message : 'Unknown export error';
                vscode.postMessage({
                  command: 'exportError',
                  payload: { error: 'Export failed: ' + errorMessage }
                });
              });
          }

          // Global functions for HTML handlers (if needed)
          function refresh() {
            vscode.postMessage({ command: 'refresh' });
          }
        </script>
      </body>
      </html>
    `;
  }

  /**
   * Handle export functionality (matches BaseFlowchartProvider implementation)
   */
  private async handleExport(payload: {
    fileType: "svg" | "png";
    data: string;
  }): Promise<void> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showErrorMessage(
        "Cannot export: No active text editor found."
      );
      return;
    }

    const { fileType, data } = payload;
    const documentUri = activeEditor.document.uri;

    const defaultDirectory = vscode.Uri.file(
      require("path").dirname(documentUri.fsPath)
    );
    const defaultFileUri = vscode.Uri.file(
      require("path").join(
        defaultDirectory.fsPath,
        `data-flow-analysis.${fileType}`
      )
    );

    const filters: { [name: string]: string[] } =
      fileType === "svg"
        ? { "SVG Images": ["svg"] }
        : { "PNG Images": ["png"] };

    const uri = await vscode.window.showSaveDialog({
      filters,
      defaultUri: defaultFileUri,
    });

    if (uri) {
      const buffer = Buffer.from(data, fileType === "png" ? "base64" : "utf-8");
      try {
        await vscode.workspace.fs.writeFile(uri, buffer);
        vscode.window.showInformationMessage(
          `Successfully exported data flow analysis to ${uri.fsPath}`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(
          `Failed to export data flow analysis: ${message}`
        );
      }
    }
  }

  /**
   * Generates a random nonce for Content Security Policy (matches BaseFlowchartProvider)
   */
  private _getNonce(): string {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
