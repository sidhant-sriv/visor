import * as vscode from "vscode";
import { analyzeCode } from "../logic/analyzer";
import { LocationMapEntry } from "../ir/ir";

const MERMAID_VERSION = "11.8.0";
const SVG_PAN_ZOOM_VERSION = "3.6.1";

/**
 * Generates the complete HTML content for the webview panel.
 * This includes the Mermaid.js library and the generated flowchart syntax.
 */
function getWebviewContent(flowchartSyntax: string, nonce: string): string {
  const theme =
    vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
      ? "dark"
      : "default";

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
                stroke: #007ACC !important;
                stroke-width: 4px !important;
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
                border: 1px solid var(--vscode-button-border);
                padding: 5px 10px;
                cursor: pointer;
            }
            #export-controls button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
        </style>
    </head>
    <body>
        <div id="export-controls">
            <button id="export-svg">Export as SVG</button>
            <button id="export-png">Export as PNG</button>
        </div>
        <div id="container">
            <div class="mermaid">
${flowchartSyntax}
            </div>
        </div>
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

            function cleanSvgForExport(svgElement) {
                const svgClone = svgElement.cloneNode(true);
                
                // Only remove pan-zoom controls, preserve all Mermaid content
                const controlsSelectors = [
                    '.svg-pan-zoom-controls'
                ];
                
                controlsSelectors.forEach(selector => {
                    const elements = svgClone.querySelectorAll(selector);
                    elements.forEach(el => {
                        el.remove();
                    });
                });
                
                // Remove only pan-zoom specific attributes, not all attributes
                svgClone.removeAttribute('data-svg-pan-zoom');
                
                // Reset any transforms on the clone to get the entire content
                const mainGroup = svgClone.querySelector('g');
                if (mainGroup) {
                    // Remove any existing transforms that might be from pan/zoom
                    mainGroup.removeAttribute('transform');
                }
                
                // Get the bounding box of all content in the clone (without transforms)
                // Create a temporary SVG to measure the actual content size
                const tempDiv = document.createElement('div');
                tempDiv.style.position = 'absolute';
                tempDiv.style.visibility = 'hidden';
                tempDiv.style.top = '-9999px';
                document.body.appendChild(tempDiv);
                tempDiv.appendChild(svgClone);
                
                // Get the bounding box of the entire flowchart content
                const bbox = svgClone.getBBox();
                
                // Clean up temporary element
                document.body.removeChild(tempDiv);
                
                const padding = 20;
                const totalWidth = bbox.width + (padding * 2);
                const totalHeight = bbox.height + (padding * 2);
                
                // Adjust viewBox to show entire content with padding
                const viewBoxX = bbox.x - padding;
                const viewBoxY = bbox.y - padding;
                
                // Set proper dimensions and viewBox to capture entire flowchart
                svgClone.setAttribute('width', totalWidth.toString());
                svgClone.setAttribute('height', totalHeight.toString());
                svgClone.setAttribute('viewBox', \`\${viewBoxX} \${viewBoxY} \${totalWidth} \${totalHeight}\`);
                
                // Add background for PNG exports
                const backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-background').trim() || '#ffffff';
                
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', viewBoxX.toString());
                rect.setAttribute('y', viewBoxY.toString());
                rect.setAttribute('width', totalWidth.toString());
                rect.setAttribute('height', totalHeight.toString());
                rect.setAttribute('fill', backgroundColor);
                svgClone.insertBefore(rect, svgClone.firstChild);
                
                return svgClone;
            }

            function exportFlowchart(fileType) {
                const svgElement = document.querySelector('.mermaid svg');
                if (!svgElement) {
                    vscode.postMessage({
                        command: 'exportError',
                        payload: { error: "Mermaid SVG element not found" }
                    });
                    return;
                }

                try {
                    const svgClone = cleanSvgForExport(svgElement);
                    const svgData = new XMLSerializer().serializeToString(svgClone);

                    if (fileType === 'svg') {
                        vscode.postMessage({
                            command: 'export',
                            payload: { fileType: 'svg', data: svgData }
                        });
                    } else if (fileType === 'png') {
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        
                        if (!ctx) {
                            throw new Error("Could not get canvas 2D context");
                        }
                        
                        // Get dimensions from the cleaned SVG
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = svgData;
                        const tempSvg = tempDiv.querySelector('svg');
                        
                        if (!tempSvg) {
                            throw new Error("Could not parse cleaned SVG");
                        }
                        
                        const width = parseFloat(tempSvg.getAttribute('width')) || 800;
                        const height = parseFloat(tempSvg.getAttribute('height')) || 600;
                        
                        // Set canvas size
                        const scale = 2; // Higher DPI
                        canvas.width = width * scale;
                        canvas.height = height * scale;
                        ctx.scale(scale, scale);
                        
                        // Create a clean data URL
                        const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData);
                        
                        const img = new Image();
                        img.onload = function() {
                            try {
                                // Clear canvas with background color
                                const backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-background').trim() || '#ffffff';
                                ctx.fillStyle = backgroundColor;
                                ctx.fillRect(0, 0, width, height);
                                
                                // Draw the SVG
                                ctx.drawImage(img, 0, 0, width, height);
                                
                                const pngData = canvas.toDataURL('image/png', 1.0);
                                const base64Data = pngData.split(',')[1];
                                
                                vscode.postMessage({
                                    command: 'export',
                                    payload: { 
                                        fileType: 'png', 
                                        data: base64Data
                                    }
                                });
                            } catch (e) {
                                vscode.postMessage({
                                    command: 'exportError',
                                    payload: { error: \`Canvas error: \${e.message}\` }
                                });
                            }
                        };
                        
                        img.onerror = function(e) {
                            vscode.postMessage({
                                command: 'exportError',
                                payload: { error: "SVG to PNG conversion failed - image load error" }
                            });
                        };
                        
                        // Load the image
                        img.src = svgDataUrl;
                    }
                } catch (error) {
                    vscode.postMessage({
                        command: 'exportError',
                        payload: { error: \`Export failed: \${error.message}\` }
                    });
                }
            }

            document.getElementById('export-svg').addEventListener('click', () => exportFlowchart('svg'));
            document.getElementById('export-png').addEventListener('click', () => exportFlowchart('png'));
        </script>
    </body>
    </html>`;
}

export class FlowchartViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "sidvis.flowchartView";
  private _view?: vscode.WebviewView;
  private _disposables: vscode.Disposable[] = [];
  private _locationMap: LocationMapEntry[] = [];
  private _currentFunctionRange: vscode.Range | undefined;

  constructor(private readonly _extensionUri: vscode.Uri) {}

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

    this.updateView(vscode.window.activeTextEditor);

    vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        this.updateView(editor);
      },
      null,
      this._disposables
    );

    vscode.window.onDidChangeTextEditorSelection(
      (event) => {
        if (event.textEditor === vscode.window.activeTextEditor && this._view) {
          const selection = event.selections[0];
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
            this.updateView(event.textEditor);
          }
        }
      },
      null,
      this._disposables
    );

    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "highlightCode":
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
          case "export":
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
              vscode.window.showErrorMessage(
                "Cannot export: No active text editor found."
              );
              return;
            }

            const { fileType, data } = message.payload;
            const documentUri = activeEditor.document.uri;

            const path = require("path");
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
          case "exportError":
            vscode.window.showErrorMessage(
              `Export failed: ${message.payload.error}`
            );
            break;
        }
      },
      null,
      this._disposables
    );
  }

  private updateView(editor: vscode.TextEditor | undefined) {
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

    console.time("analyzeCode");
    const { flowchart, locationMap, functionRange } = analyzeCode(
      document.getText(),
      position,
      document.languageId
    );
    console.timeEnd("analyzeCode");

    this._locationMap = locationMap;
    if (functionRange) {
      this._currentFunctionRange = new vscode.Range(
        document.positionAt(functionRange.start),
        document.positionAt(functionRange.end)
      );
    } else {
      this._currentFunctionRange = undefined;
    }

    this._view.webview.html = getWebviewContent(flowchart, this.getNonce());

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
  }

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

  private getNonce() {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  public dispose() {
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
