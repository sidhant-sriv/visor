import * as vscode from "vscode";
import * as path from "path";
import { analyzeCode } from "../logic/analyzer";
import { LocationMapEntry } from "../ir/ir";
import { EnhancedMermaidGenerator } from "../logic/EnhancedMermaidGenerator";
import { SubtleThemeManager } from "../logic/utils/ThemeManager";
import { getComplexityConfig } from "../logic/utils/ComplexityConfig";

const MERMAID_VERSION = "11.8.0";
const SVG_PAN_ZOOM_VERSION = "3.6.1";

// Define specific types for messages from the webview to avoid `any`
type HighlightCodeMessage = {
  command: "highlightCode";
  payload: { start: number; end: number };
};

type ExportMessage = {
  command: "export";
  payload: { fileType: "svg" | "png"; data: string };
};

type ExportErrorMessage = {
  command: "exportError";
  payload: { error: string };
};

type WebviewMessage = HighlightCodeMessage | ExportMessage | ExportErrorMessage;

/**
 * Generates the complete HTML content for the webview panel.
 * This includes the Mermaid.js library, export controls, complexity display, and the generated flowchart syntax.
 */
function getWebviewContent(
  flowchartSyntax: string,
  nonce: string,
  functionComplexity?: {
    cyclomaticComplexity: number;
    rating: "low" | "medium" | "high" | "very-high";
    description: string;
  }
): string {
  const theme =
    vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
      ? "dark"
      : "default";

  // Get complexity configuration for dynamic styling
  const complexityConfig = getComplexityConfig();
  return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data:; font-src https://cdn.jsdelivr.net;">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Code Flowchart</title>
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
            #container {
                width: 100%;
                height: 100%;
            }
            .mermaid {
                width: 100%;
                height: 100%;
            }
             .mermaid svg {
                width: 100%;
                height: 100%;
            }
            .highlighted > rect,
            .highlighted > polygon,
            .highlighted > circle,
            .highlighted > path {
                stroke: var(--vscode-editor-selectionBackground) !important;
                stroke-width: 4px !important;
            }
            
            /* Enhanced node styling - no animations */
            .mermaid .node {
                filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1));
            }
            
            /* Enhanced text readability */
            .mermaid .node text {
                font-family: var(--vscode-font-family), 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                font-size: 12px;
                text-anchor: middle;
                dominant-baseline: central;
            }
            
            /* Subtle highlighting for current node */
            .mermaid .node.highlighted {
                filter: drop-shadow(0 0 8px var(--vscode-focusBorder));
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
            #export-controls {
                position: absolute;
                top: 10px;
                right: 10px;
                z-index: 1000;
                display: flex;
                gap: 10px;
            }
            #export-controls button {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: 1px solid var(--vscode-button-border, transparent);
                padding: 5px 10px;
                cursor: pointer;
                border-radius: 4px;
            }
            #export-controls button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
            
            /* Complexity display panel - positioned at bottom to not interfere with export buttons */
            #complexity-panel {
                position: fixed;
                bottom: 10px;
                left: 10px;
                z-index: 1000;
                background-color: var(--vscode-editor-background);
                border: 1px solid var(--vscode-editorWidget-border);
                border-radius: 6px;
                padding: 8px 12px;
                font-size: 12px;
                color: var(--vscode-editor-foreground);
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                max-width: 300px;
                transition: opacity 0.3s ease;
            }
            
            #complexity-panel.hidden {
                display: none;
            }
            
            #complexity-toggle {
                position: fixed;
                bottom: 10px;
                right: 10px;
                z-index: 1001;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: 1px solid var(--vscode-button-border, transparent);
                padding: 6px 10px;
                cursor: pointer;
                border-radius: 4px;
                font-size: 11px;
            }
            
            #complexity-toggle:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
            
            .complexity-rating {
                font-weight: bold;
                margin-left: 4px;
            }
            
            .complexity-low { color: ${complexityConfig.colors.low}; }
            .complexity-medium { color: ${complexityConfig.colors.medium}; }
            .complexity-high { color: ${complexityConfig.colors.high}; }
            .complexity-very-high { color: ${
              complexityConfig.colors.veryHigh
            }; }
            
            .complexity-description {
                margin-top: 4px;
                font-size: 11px;
                opacity: 0.8;
            }
            
            /* Hidden element to store original mermaid source */
            #mermaid-source {
                display: none;
            }
        </style>
    </head>
    <body>
        ${
          functionComplexity
            ? `
        <div id="complexity-panel">
            <div>
                <strong>Cyclomatic Complexity:</strong> 
                ${functionComplexity.cyclomaticComplexity}
                <span class="complexity-rating complexity-${
                  functionComplexity.rating
                }">
                    (${functionComplexity.rating.toUpperCase()})
                </span>
            </div>
            <div class="complexity-description">
                ${functionComplexity.description}
            </div>
        </div>
        <button id="complexity-toggle" title="Toggle complexity display">📊</button>
        `
            : ""
        }
        <div id="export-controls">
            <button id="export-svg">Export as SVG</button>
            <button id="export-png">Export as PNG</button>
        </div>
        <div id="container">
            <div class="mermaid">
${flowchartSyntax}
            </div>
        </div>
        <!-- Store the original mermaid source for export -->
        <div id="mermaid-source">${flowchartSyntax
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</div>
        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();

            function onNodeClick(start, end) {
                vscode.postMessage({
                    command: 'highlightCode',
                    payload: { start, end }
                });
            }

            let highlightedNodeId = null;

            window.addEventListener('message', event => {
                const message = event.data;
                switch (message.command) {
                    case 'highlightNode':
                        if (highlightedNodeId) {
                            const oldElem = document.getElementById(highlightedNodeId);
                            if (oldElem) oldElem.classList.remove('highlighted');
                        }

                        const newId = message.payload.nodeId;
                        if (newId) {
                            const newElem = document.getElementById(newId);
                            if (newElem) newElem.classList.add('highlighted');
                        }
                        highlightedNodeId = newId;
                        break;
                    case 'exportError':
                        // VSC will show the error message
                        break;
                }
            });

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

            window.addEventListener('load', () => {
                const svgElement = document.querySelector('.mermaid svg');
                if (svgElement) {
                    svgPanZoom(svgElement, {
                        zoomEnabled: true,
                        controlIconsEnabled: true,
                        fit: true,
                        center: true,
                    });
                }
            });

            /**
             * Handles exporting the flowchart to SVG or PNG.
             * It generates a clean SVG from the source to ensure no UI controls are included.
             */
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

            document.getElementById('export-svg').addEventListener('click', () => exportFlowchart('svg'));
            document.getElementById('export-png').addEventListener('click', () => exportFlowchart('png'));
            
            // Complexity toggle functionality
            const complexityToggle = document.getElementById('complexity-toggle');
            const complexityPanel = document.getElementById('complexity-panel');
            if (complexityToggle && complexityPanel) {
                // Get initial state from localStorage or default to visible
                const isHidden = localStorage.getItem('complexity-panel-hidden') === 'true';
                if (isHidden) {
                    complexityPanel.classList.add('hidden');
                    complexityToggle.textContent = '📊';
                    complexityToggle.title = 'Show complexity display';
                } else {
                    complexityToggle.textContent = '📊✓';
                    complexityToggle.title = 'Hide complexity display';
                }
                
                complexityToggle.addEventListener('click', () => {
                    const isCurrentlyHidden = complexityPanel.classList.contains('hidden');
                    if (isCurrentlyHidden) {
                        complexityPanel.classList.remove('hidden');
                        complexityToggle.textContent = '📊✓';
                        complexityToggle.title = 'Hide complexity display';
                        localStorage.setItem('complexity-panel-hidden', 'false');
                    } else {
                        complexityPanel.classList.add('hidden');
                        complexityToggle.textContent = '📊';
                        complexityToggle.title = 'Show complexity display';
                        localStorage.setItem('complexity-panel-hidden', 'true');
                    }
                });
            }
        </script>
    </body>
    </html>`;
}

export class FlowchartViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "visor.flowchartView";
  private _view?: vscode.WebviewView;
  private _disposables: vscode.Disposable[] = [];
  private _locationMap: LocationMapEntry[] = [];
  private _currentFunctionRange: vscode.Range | undefined;
  private _debounceTimer?: NodeJS.Timeout; // For live updates

  /**
   * Get available themes for configuration UI
   */
  public static getAvailableThemes() {
    return SubtleThemeManager.getAvailableThemes();
  }

  constructor(private readonly _extensionUri: vscode.Uri) {
    // Listen for configuration changes to update themes
    this._disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("visor.nodeReadability.theme")) {
          // Refresh the current view when theme changes
          this.updateView(vscode.window.activeTextEditor);
        }
      })
    );
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

    // Initial update
    this.updateView(vscode.window.activeTextEditor);

    // Listen for changes to the active editor
    vscode.window.onDidChangeActiveTextEditor(
      async (editor) => {
        await this.updateView(editor);
      },
      null,
      this._disposables
    );

    // Listen for selection changes in the active editor
    vscode.window.onDidChangeTextEditorSelection(
      async (event) => {
        if (event.textEditor === vscode.window.activeTextEditor && this._view) {
          const selection = event.selections[0];
          // If the cursor is still within the same function, just highlight the node
          if (
            this._currentFunctionRange &&
            this._currentFunctionRange.contains(selection)
          ) {
            const offset = event.textEditor.document.offsetAt(selection.active);
            const entry = this._locationMap.find(
              (e) => offset >= e.start && offset <= e.end
            );
            this._view.webview.postMessage({
              command: "highlightNode",
              payload: { nodeId: entry ? entry.nodeId : null },
            });
          } else {
            // If the cursor moves out of the function, regenerate the flowchart
            await this.updateView(event.textEditor);
          }
        }
      },
      null,
      this._disposables
    );

    // Listen for changes to the document text for live updates
    vscode.workspace.onDidChangeTextDocument(
      (event) => {
        if (event.document === vscode.window.activeTextEditor?.document) {
          // Clear the previous timer if it exists
          if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
          }
          // Set a new timer to update the view after a short delay (e.g., 500ms)
          this._debounceTimer = setTimeout(() => {
            this.updateView(vscode.window.activeTextEditor);
          }, 500);
        }
      },
      null,
      this._disposables
    );

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        switch (message.command) {
          case "highlightCode": {
            const { start, end } = message.payload;
            const editor = vscode.window.activeTextEditor;
            if (editor) {
              const startPos = editor.document.positionAt(start);
              const endPos = editor.document.positionAt(end);
              const range = new vscode.Range(startPos, endPos);

              editor.selection = new vscode.Selection(range.start, range.end);
              editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            }
            break;
          }

          case "export": {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
              vscode.window.showErrorMessage(
                "Cannot export: No active text editor found."
              );
              return;
            }

            const { fileType, data } = message.payload;
            const documentUri = activeEditor.document.uri;

            const defaultDirectory = vscode.Uri.file(
              path.dirname(documentUri.fsPath)
            );
            const defaultFileUri = vscode.Uri.file(
              path.join(defaultDirectory.fsPath, `flowchart.${fileType}`)
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
              const buffer = Buffer.from(
                data,
                fileType === "png" ? "base64" : "utf-8"
              );
              try {
                await vscode.workspace.fs.writeFile(uri, buffer);
                vscode.window.showInformationMessage(
                  `Successfully exported flowchart to ${uri.fsPath}`
                );
              } catch (err) {
                const message =
                  err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(
                  `Failed to export flowchart: ${message}`
                );
              }
            }
            break;
          }

          case "exportError": {
            vscode.window.showErrorMessage(
              `Export failed: ${message.payload.error}`
            );
            break;
          }
        }
      },
      null,
      this._disposables
    );
  }

  /**
   * Main method to update the webview content. It analyzes the code and redraws the flowchart.
   */
  public async updateView(editor: vscode.TextEditor | undefined) {
    if (!this._view) {
      return;
    }

    if (!editor) {
      this._view.webview.html = this.getLoadingHtml(
        "Please open a file to see the flowchart."
      );
      return;
    }

    this._view.webview.html = this.getLoadingHtml("Generating flowchart...");

    const position = editor.document.offsetAt(editor.selection.active);
    const document = editor.document;

    try {
      console.time("analyzeCode");
      const flowchartIR = await analyzeCode(
        document.getText(),
        document.languageId,
        undefined,
        position
      );
      console.timeEnd("analyzeCode");

      this._locationMap = flowchartIR.locationMap;
      if (flowchartIR.functionRange) {
        this._currentFunctionRange = new vscode.Range(
          document.positionAt(flowchartIR.functionRange.start),
          document.positionAt(flowchartIR.functionRange.end)
        );
      } else {
        this._currentFunctionRange = undefined;
      }

      // Generate Mermaid diagram from FlowchartIR with enhanced styling
      const vsCodeTheme =
        vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
          ? "dark"
          : "light";

      // Read the selected theme from user configuration
      const config = vscode.workspace.getConfiguration("visor");
      const selectedTheme = config.get<string>(
        "nodeReadability.theme",
        "monokai"
      );

      const mermaidGenerator = new EnhancedMermaidGenerator(
        selectedTheme,
        vsCodeTheme
      );
      const mermaidCode = mermaidGenerator.generate(flowchartIR);

      // Only pass complexity info if it's enabled and should be displayed in panel
      const complexityConfig = getComplexityConfig();
      const complexityToDisplay =
        complexityConfig.enabled &&
        complexityConfig.displayInPanel &&
        flowchartIR.functionComplexity
          ? flowchartIR.functionComplexity
          : undefined;

      this._view.webview.html = getWebviewContent(
        mermaidCode,
        this.getNonce(),
        complexityToDisplay
      );

      // After updating the view, immediately highlight the node for the current cursor
      const offset = editor.document.offsetAt(editor.selection.active);
      const entry = this._locationMap.find(
        (e) => offset >= e.start && offset <= e.end
      );
      if (this._view) {
        this._view.webview.postMessage({
          command: "highlightNode",
          payload: { nodeId: entry ? entry.nodeId : null },
        });
      }
    } catch (error) {
      console.error("Failed to update view:", error);
      const errorMessage =
        error instanceof Error ? error.message : "An unknown error occurred";
      this._view.webview.html = this.getLoadingHtml(`Error: ${errorMessage}`);
    }
  }

  /**
   * Generates a simple HTML page to show a loading or informational message.
   */
  private getLoadingHtml(message: string): string {
    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body, html {
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    font-family: var(--vscode-font-family);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100%;
                    width: 100%;
                    margin: 0;
                    padding: 0;
                }
            </style>
        </head>
        <body>
            <p>${message}</p>
        </body>
        </html>`;
  }

  /**
   * Generates a random nonce for Content Security Policy.
   */
  private getNonce() {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  /**
   * Cleans up disposables when the view is closed.
   */
  public dispose() {
    // Clear the timer when the provider is disposed
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
