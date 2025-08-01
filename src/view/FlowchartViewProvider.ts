import * as vscode from "vscode";
import { analyzeCode } from "../logic/analyzer";
import { LocationMapEntry } from "../ir/ir";

const MERMAID_VERSION = "11.8.0";
const SVG_PAN_ZOOM_VERSION = "3.6.1";

/**
 * Generates the complete HTML content for the webview panel.
 * This includes the Mermaid.js library, export controls, and the generated flowchart syntax.
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
                stroke: var(--vscode-editor-selectionBackground) !important;
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
                border: 1px solid var(--vscode-button-border, transparent);
                padding: 5px 10px;
                cursor: pointer;
                border-radius: 4px;
            }
            #export-controls button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
            /* Hidden element to store original mermaid source */
            #mermaid-source {
                display: none;
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
        <!-- Store the original mermaid source for export -->
        <div id="mermaid-source">${flowchartSyntax.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
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

            function cleanSvgForExport(svgElement) {
                const svgClone = svgElement.cloneNode(true);
                
                // Remove pan-zoom controls
                const controls = svgClone.querySelector('.svg-pan-zoom-controls');
                if (controls) {
                    controls.remove();
                }
                svgClone.removeAttribute('data-svg-pan-zoom');
                
                // Reset pan-zoom transform and restore original dimensions
                const viewport = svgClone.querySelector('.svg-pan-zoom_viewport');
                if (viewport) {
                    viewport.removeAttribute('transform');
                }
                
                // Remove any width/height constraints that might be set by pan-zoom
                svgClone.removeAttribute('width');
                svgClone.removeAttribute('height');
                svgClone.removeAttribute('viewBox');
                svgClone.removeAttribute('style');
                
                // Create a temporary container with no styling constraints
                const tempDiv = document.createElement('div');
                tempDiv.style.position = 'absolute';
                tempDiv.style.visibility = 'hidden';
                tempDiv.style.top = '-9999px';
                tempDiv.style.width = 'auto';
                tempDiv.style.height = 'auto';
                tempDiv.style.overflow = 'visible';
                document.body.appendChild(tempDiv);
                tempDiv.appendChild(svgClone);
                
                // Force a reflow to ensure the SVG is rendered without constraints
                svgClone.style.width = 'auto';
                svgClone.style.height = 'auto';
                svgClone.style.maxWidth = 'none';
                svgClone.style.maxHeight = 'none';
                
                // Get the bounding box of all content
                let bbox;
                try {
                    bbox = svgClone.getBBox();
                } catch (e) {
                    // Fallback: try to get dimensions from the root g element
                    const rootG = svgClone.querySelector('g');
                    if (rootG) {
                        bbox = rootG.getBBox();
                    } else {
                        // Ultimate fallback
                        bbox = { x: 0, y: 0, width: 800, height: 600 };
                    }
                }
                
                document.body.removeChild(tempDiv);
                
                const padding = 20;
                const totalWidth = bbox.width + (padding * 2);
                const totalHeight = bbox.height + (padding * 2);
                const viewBoxX = bbox.x - padding;
                const viewBoxY = bbox.y - padding;
                
                // Set proper dimensions and viewBox to capture the entire flowchart
                svgClone.setAttribute('width', totalWidth.toString());
                svgClone.setAttribute('height', totalHeight.toString());
                svgClone.setAttribute('viewBox', \`\${viewBoxX} \${viewBoxY} \${totalWidth} \${totalHeight}\`);
                
                // Add a background rect
                const backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-background').trim() || '#ffffff';
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', viewBoxX.toString());
                rect.setAttribute('y', viewBoxY.toString());
                rect.setAttribute('width', totalWidth.toString());
                rect.setAttribute('height', totalHeight.toString());
                rect.setAttribute('fill', backgroundColor);
                svgClone.insertBefore(rect, svgClone.firstChild);
                
                return {
                    svgElement: svgClone,
                    width: totalWidth,
                    height: totalHeight
                };
            }

            // Helper function for fallback SVG export
            function fallbackSvgExport(svgElement) {
                try {
                    const { svgElement: svgClone } = cleanSvgForExport(svgElement);
                    const svgData = new XMLSerializer().serializeToString(svgClone);
                    vscode.postMessage({
                        command: 'export',
                        payload: { fileType: 'svg', data: svgData }
                    });
                } catch (fallbackError) {
                    vscode.postMessage({
                        command: 'exportError',
                        payload: { error: 'SVG export failed: ' + fallbackError.message }
                    });
                }
            }

            function exportFlowchart(fileType) {
                const svgElement = document.querySelector('.mermaid svg');
                if (!svgElement) {
                    vscode.postMessage({
                        command: 'exportError',
                        payload: { error: "Mermaid SVG element not found." }
                    });
                    return;
                }

                try {
                    if (fileType === 'svg') {
                        // Get the original mermaid source from the hidden element
                        const mermaidSourceElement = document.getElementById('mermaid-source');
                        if (!mermaidSourceElement) {
                            console.warn('Mermaid source element not found, falling back to text extraction');
                            fallbackSvgExport(svgElement);
                            return;
                        }
                        
                        let mermaidSource = mermaidSourceElement.innerHTML
                            .replace(/&lt;/g, '<')
                            .replace(/&gt;/g, '>')
                            .replace(/&amp;/g, '&');
                        
                        // Clean up the mermaid source - remove extra whitespace and ensure proper format
                        mermaidSource = mermaidSource.trim();
                        
                        // Validate that we have valid mermaid syntax
                        if (!mermaidSource || mermaidSource.length === 0) {
                            console.warn('Empty mermaid source, falling back to existing SVG');
                            fallbackSvgExport(svgElement);
                            return;
                        }
                        
                        // Create a unique ID for this export
                        const exportId = 'export-svg-' + Date.now();
                        
                        // Create a temporary container for clean rendering
                        const tempContainer = document.createElement('div');
                        tempContainer.style.position = 'absolute';
                        tempContainer.style.visibility = 'hidden';
                        tempContainer.style.top = '-9999px';
                        tempContainer.style.left = '-9999px';
                        tempContainer.style.width = 'auto';
                        tempContainer.style.height = 'auto';
                        tempContainer.style.overflow = 'visible';
                        tempContainer.className = 'mermaid-export-temp';
                        document.body.appendChild(tempContainer);
                        
                        // Use mermaid.render with proper error handling
                        mermaid.render(exportId, mermaidSource)
                            .then((result) => {
                                // Clean up temp container
                                if (document.body.contains(tempContainer)) {
                                    document.body.removeChild(tempContainer);
                                }
                                
                                try {
                                    // Parse the SVG and add background
                                    const parser = new DOMParser();
                                    const svgDoc = parser.parseFromString(result.svg, 'image/svg+xml');
                                    const cleanSvg = svgDoc.documentElement;
                                    
                                    if (!cleanSvg || cleanSvg.tagName !== 'svg') {
                                        throw new Error('Invalid SVG generated by Mermaid render');
                                    }
                                    
                                    // Get the viewBox or calculate dimensions
                                    const viewBox = cleanSvg.getAttribute('viewBox');
                                    let bbox;
                                    
                                    if (viewBox) {
                                        const parts = viewBox.split(' ').map(Number);
                                        bbox = {
                                            x: parts[0] || 0,
                                            y: parts[1] || 0,
                                            width: parts[2] || 800,
                                            height: parts[3] || 600
                                        };
                                    } else {
                                        // Try to get bounding box
                                        try {
                                            bbox = cleanSvg.getBBox();
                                        } catch (e) {
                                            // Fallback dimensions
                                            bbox = { x: 0, y: 0, width: 800, height: 600 };
                                        }
                                    }
                                    
                                    // Add padding
                                    const padding = 20;
                                    const finalX = bbox.x - padding;
                                    const finalY = bbox.y - padding;
                                    const finalWidth = bbox.width + (padding * 2);
                                    const finalHeight = bbox.height + (padding * 2);
                                    
                                    // Set proper dimensions
                                    cleanSvg.setAttribute('width', finalWidth.toString());
                                    cleanSvg.setAttribute('height', finalHeight.toString());
                                    cleanSvg.setAttribute('viewBox', \`\${finalX} \${finalY} \${finalWidth} \${finalHeight}\`);
                                    
                                    // Add background rectangle
                                    const backgroundColor = getComputedStyle(document.documentElement)
                                        .getPropertyValue('--vscode-editor-background').trim() || '#ffffff';
                                    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                                    rect.setAttribute('x', finalX.toString());
                                    rect.setAttribute('y', finalY.toString());
                                    rect.setAttribute('width', finalWidth.toString());
                                    rect.setAttribute('height', finalHeight.toString());
                                    rect.setAttribute('fill', backgroundColor);
                                    cleanSvg.insertBefore(rect, cleanSvg.firstChild);
                                    
                                    // Serialize and send
                                    const svgData = new XMLSerializer().serializeToString(cleanSvg);
                                    vscode.postMessage({
                                        command: 'export',
                                        payload: { fileType: 'svg', data: svgData }
                                    });
                                    
                                } catch (parseError) {
                                    console.error('SVG parsing error:', parseError);
                                    // Fallback to the cleaned pan-zoom method
                                    fallbackSvgExport(svgElement);
                                }
                            })
                            .catch((renderError) => {
                                console.error('Mermaid render error:', renderError);
                                // Clean up temp container
                                if (document.body.contains(tempContainer)) {
                                    document.body.removeChild(tempContainer);
                                }
                                // Fallback to the cleaned pan-zoom method
                                fallbackSvgExport(svgElement);
                            });
                        
                        return; // Early return for SVG
                    }
                    
                    // PNG export (unchanged)
                    const { svgElement: svgClone, width, height } = cleanSvgForExport(svgElement);
                    const svgData = new XMLSerializer().serializeToString(svgClone);

                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    
                    if (!ctx) {
                        throw new Error("Could not get canvas 2D context.");
                    }
                    
                    const scale = 2; // For higher DPI
                    canvas.width = width * scale;
                    canvas.height = height * scale;
                    ctx.scale(scale, scale);
                    
                    const img = new Image();
                    img.onload = function() {
                        try {
                            ctx.drawImage(img, 0, 0, width, height);
                            const pngData = canvas.toDataURL('image/png');
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
                                payload: { error: 'Canvas error: ' + e.message }
                            });
                        }
                    };
                    
                    img.onerror = function() {
                        vscode.postMessage({
                            command: 'exportError',
                            payload: { error: "SVG to PNG conversion failed (image load error)." }
                        });
                    };
                    
                    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData);
                    
                } catch (error) {
                    vscode.postMessage({
                        command: 'exportError',
                        payload: { error: 'Export failed: ' + error.message }
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
  public static readonly viewType = "visor.flowchartView";
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

    // Handle messages from the webview
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
              vscode.window.showErrorMessage("Cannot export: No active text editor found.");
              return;
            }

            const { fileType, data } = message.payload;
            const documentUri = activeEditor.document.uri;

            const path = require("path");
            const defaultDirectory = vscode.Uri.file(path.dirname(documentUri.fsPath));
            const defaultFileUri = vscode.Uri.file(path.join(defaultDirectory.fsPath, `flowchart.${fileType}`));

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
                vscode.window.showInformationMessage(`Successfully exported flowchart to ${uri.fsPath}`);
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`Failed to export flowchart: ${message}`);
              }
            }
            break;

          case "exportError":
            vscode.window.showErrorMessage(`Export failed: ${message.payload.error}`);
            break;
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
      this._view.webview.html = this.getLoadingHtml("Please open a file to see the flowchart.");
      return;
    }

    this._view.webview.html = this.getLoadingHtml("Generating flowchart...");

    const position = editor.document.offsetAt(editor.selection.active);
    const document = editor.document;

    try {
        console.time("analyzeCode");
        const { flowchart, locationMap, functionRange } = await analyzeCode(
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
    } catch (error: any) {
        console.error("Failed to update view:", error);
        this._view.webview.html = this.getLoadingHtml(`Error: ${error.message}`);
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
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}