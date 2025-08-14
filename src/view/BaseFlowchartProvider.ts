import * as vscode from "vscode";
import { analyzeCode } from "../logic/analyzer";
import { LocationMapEntry } from "../ir/ir";
import { EnhancedMermaidGenerator } from "../logic/EnhancedMermaidGenerator";
import { getComplexityConfig } from "../logic/utils/ComplexityConfig";
import { EnvironmentDetector } from "../logic/utils/EnvironmentDetector";

const MERMAID_VERSION = "11.8.0";
const SVG_PAN_ZOOM_VERSION = "3.6.1";

// Define specific types for messages from the webview to avoid `any`
export type HighlightCodeMessage = {
  command: "highlightCode";
  payload: { start: number; end: number };
};

export type ExportMessage = {
  command: "export";
  payload: { fileType: "svg" | "png"; data: string };
};

export type ExportErrorMessage = {
  command: "exportError";
  payload: { error: string };
};

export type OpenInPanelMessage = {
  command: "openInPanel";
  payload: {};
};

// New message type for copying mermaid code
export type CopyMermaidMessage = {
  command: "copyMermaid";
  payload: { code: string };
};

export type WebviewMessage =
  | HighlightCodeMessage
  | ExportMessage
  | ExportErrorMessage
  | OpenInPanelMessage
  | CopyMermaidMessage;

export interface FlowchartViewContext {
  isPanel: boolean;
  showPanelButton: boolean;
}

/**
 * Abstract base class for flowchart providers that contains shared functionality
 * between sidebar and panel implementations.
 */
export abstract class BaseFlowchartProvider {
  protected _disposables: vscode.Disposable[] = [];
  protected _locationMap: LocationMapEntry[] = [];
  protected _currentFunctionRange: vscode.Range | undefined;
  protected _debounceTimer?: NodeJS.Timeout;
  protected _currentDocument?: vscode.TextDocument;
  protected _currentPosition?: number;
  protected _isUpdating: boolean = false;
  protected _eventListenersSetup: boolean = false;

  constructor(protected readonly _extensionUri: vscode.Uri) {
    // Detect environment and apply any necessary compatibility fixes
    this.initializeEnvironment();
    
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

  /**
   * Initialize environment-specific settings and compatibility fixes
   */
  private initializeEnvironment(): void {
    const env = EnvironmentDetector.detectEnvironment();
    
    if (env.requiresCompatibilityMode) {
      console.log(`Visor: Running in compatibility mode for ${env.editor}`);
      
      // Add any environment-specific initialization here
      if (env.isCursor) {
        // Cursor-specific initialization
        console.log("Visor: Applying Cursor-specific compatibility settings");
      } else if (env.isWindsurf) {
        // Windsurf-specific initialization  
        console.log("Visor: Applying Windsurf-specific compatibility settings");
      } else if (env.isTrae) {
        // Trae-specific initialization
        console.log("Visor: Applying Trae-specific compatibility settings");
      }
    }
  }

  /**
   * Abstract methods that subclasses must implement
   */
  protected abstract getWebview(): vscode.Webview | undefined;
  protected abstract setWebviewHtml(html: string): void;
  protected abstract getViewContext(): FlowchartViewContext;

  /**
   * Set up event listeners for editor changes and selection changes
   */
  protected setupEventListeners(): void {
    // Prevent setting up listeners multiple times
    if (this._eventListenersSetup) {
      return;
    }

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
        if (event.textEditor === vscode.window.activeTextEditor) {
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
            this.highlightNode(entry ? entry.nodeId : null);
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

    this._eventListenersSetup = true;
  }

  /**
   * Handle messages from the webview
   */
  protected async handleWebviewMessage(message: WebviewMessage): Promise<void> {
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
        await this.handleExport(message.payload);
        break;
      }

      case "exportError": {
        vscode.window.showErrorMessage(
          `Export failed: ${message.payload.error}`
        );
        break;
      }

      case "openInPanel": {
        // This will be handled by the FlowchartPanelProvider
        vscode.commands.executeCommand("visor.openFlowchartInNewWindow");
        break;
      }

      case "copyMermaid": {
        await vscode.env.clipboard.writeText(message.payload.code);
        vscode.window.showInformationMessage("Mermaid code copied to clipboard!");
        break;
      }
    }
  }

  /**
   * Handle export functionality
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
      require("path").join(defaultDirectory.fsPath, `flowchart.${fileType}`)
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
          `Successfully exported flowchart to ${uri.fsPath}`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(
          `Failed to export flowchart: ${message}`
        );
      }
    }
  }

  /**
   * Highlight a specific node in the flowchart
   */
  public highlightNode(nodeId: string | null): void {
    const webview = this.getWebview();
    if (webview) {
      // Sanitize nodeId before sending to webview to match sanitized IDs in the diagram
      const sanitizedNodeId = nodeId ? nodeId.replace(/\s+/g, '_').replace(/[^\w-]/g, '_').replace(/_+/g, '_') : null;
      webview.postMessage({
        command: "highlightNode",
        payload: { nodeId: sanitizedNodeId },
      });
    }
  }

  /**
   * Force update the view, ignoring the shouldUpdate check
   */
  public async forceUpdateView(
    editor: vscode.TextEditor | undefined
  ): Promise<void> {
    // Reset the updating flag to ensure we can proceed
    this._isUpdating = false;

    // Clear current state to force regeneration
    this._currentDocument = undefined;
    this._currentPosition = undefined;
    this._currentFunctionRange = undefined;

    await this.updateView(editor);
  }

  /**
   * Main method to update the webview content. It analyzes the code and redraws the flowchart.
   */
  public async updateView(
    editor: vscode.TextEditor | undefined
  ): Promise<void> {
    const webview = this.getWebview();
    if (!webview) {
      return;
    }

    // Prevent multiple simultaneous updates
    if (this._isUpdating) {
      return;
    }

    if (!editor) {
      this.setWebviewHtml(
        this.getLoadingHtml("Please open a file to see the flowchart.")
      );
      this._currentDocument = undefined;
      this._currentPosition = undefined;
      return;
    }

    const position = editor.document.offsetAt(editor.selection.active);
    const document = editor.document;

    // Check if we need to update - avoid unnecessary regeneration
    const shouldUpdate = this._shouldUpdate(document, position);
    if (!shouldUpdate) {
      // Just update highlighting if we're still in the same function
      if (
        this._currentFunctionRange &&
        this._currentFunctionRange.contains(editor.selection.active)
      ) {
        const entry = this._locationMap.find(
          (e) => position >= e.start && position <= e.end
        );
        this.highlightNode(entry ? entry.nodeId : null);
      }
      return;
    }

    this._isUpdating = true;
    this.setWebviewHtml(this.getLoadingHtml("Generating flowchart..."));

    try {
      const flowchartIR = await analyzeCode(
        document.getText(),
        document.languageId,
        undefined,
        position
      );

      this._locationMap = flowchartIR.locationMap;
      this._currentDocument = document;
      this._currentPosition = position;

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

      this.setWebviewHtml(
        this.getWebviewContent(
          mermaidCode,
          this.getNonce(),
          complexityToDisplay
        )
      );

      // After updating the view, immediately highlight the node for the current cursor
      const offset = editor.document.offsetAt(editor.selection.active);
      const entry = this._locationMap.find(
        (e) => offset >= e.start && offset <= e.end
      );
      this.highlightNode(entry ? entry.nodeId : null);

    } catch (error) {
      console.error("Flowchart generation failed:", error);
      const errorMessage =
        error instanceof Error ? error.message : "An unknown error occurred";
      this.setWebviewHtml(this.getLoadingHtml(`Error: ${errorMessage}`));
    } finally {
      this._isUpdating = false;
    }
  }

  /**
   * Determines if the view should be updated based on document and position changes
   */
  private _shouldUpdate(
    document: vscode.TextDocument,
    position: number
  ): boolean {
    // Always update if no current document
    if (!this._currentDocument) {
      return true;
    }

    // Update if document changed (different file)
    if (this._currentDocument.uri.toString() !== document.uri.toString()) {
      return true;
    }

    // Update if document version changed (content was modified)
    if (this._currentDocument.version !== document.version) {
      return true;
    }

    // Update if we moved to a different function or there's no current function range
    if (!this._currentFunctionRange) {
      return true;
    }

    const currentPos = document.positionAt(position);
    if (!this._currentFunctionRange.contains(currentPos)) {
      return true;
    }

    // Don't update if we're just moving within the same function
    return false;
  }

  /**
   * Generates the complete HTML content for the webview panel.
   */
  protected getWebviewContent(
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

    const context = this.getViewContext();
    const complexityConfig = getComplexityConfig();

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">

        <meta http-equiv="Content-Security-Policy" content="${EnvironmentDetector.getContentSecurityPolicy(nonce)}">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Code Flowchart</title>
        <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.min.js"></script>
        <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/svg-pan-zoom@${SVG_PAN_ZOOM_VERSION}/dist/svg-pan-zoom.min.js"></script>
        <style>
            :root {
                --hover-fill: rgba(255, 165, 0, 0.3);
                --hover-stroke: #ff6b35;
                --hover-stroke-width: 3px;
                --hover-edge-color: #ff6b35;
                --hover-edge-width: 3px;
            }

            body, html {
                background-color: var(--vscode-editor-background);
                color: var(--vscode-editor-foreground);
                font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
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
                ${
                  context.isPanel
                    ? "margin-top: 60px; height: calc(100% - 80px);"
                    : ""
                }
            }
            .mermaid { width: 100%; height: 100%; }
            .mermaid svg { width: 100%; height: 100%; }

            /* Node highlighting styles */
            .highlighted > rect,
            .highlighted > polygon,
            .highlighted > circle,
            .highlighted > path {
                stroke: var(--vscode-editor-selectionBackground) !important;
                stroke-width: 4px !important;
            }

            /* Transitions */
            .mermaid svg .node > *, .mermaid .edge-path, .mermaid .edge-path path, .mermaid .arrowhead, .mermaid .arrowhead path, .mermaid line, .mermaid g > path {
                transition: fill 0.15s ease-in-out, stroke 0.15s ease-in-out, filter 0.15s ease-in-out, stroke-width 0.15s ease-in-out;
            }

            /* Hovered node, child, or edge */
            .mermaid svg .node.hover-highlight > *,
            .mermaid svg .node.child-highlight > * {
                fill: var(--hover-fill) !important;
                stroke: var(--hover-stroke) !important;
                stroke-width: var(--hover-stroke-width) !important;
                filter: drop-shadow(0 0 8px var(--hover-stroke));
            }
            
            /* Enhanced edge highlighting that works with different Mermaid edge structures */
            .mermaid g[class*="edge"].hover-highlight > *,
            .mermaid g[id^="L_"].hover-highlight > *,
            .mermaid path[class*="edge"].hover-highlight,
            .mermaid g.hover-highlight > path,
            .mermaid g.edgePath.hover-highlight > path.path {
                stroke: var(--hover-edge-color) !important;
                stroke-width: var(--hover-edge-width) !important;
                filter: drop-shadow(0 0 2px var(--hover-edge-color));
            }

            /* Arrow markers for highlighted edges */
            .mermaid g[class*="edge"].hover-highlight polygon,
            .mermaid g[id^="L_"].hover-highlight polygon,
            .mermaid g.hover-highlight polygon,
            .mermaid g.edgePath.hover-highlight polygon {
                fill: var(--hover-edge-color) !important;
                stroke: var(--hover-edge-color) !important;
            }

            /* Edge labels */
            .mermaid g[class*="edge"].hover-highlight text,
            .mermaid g[id^="L_"].hover-highlight text,
            .mermaid g.hover-highlight text {
                fill: var(--hover-edge-color) !important;
                font-weight: bold !important;
            }
            
            #mermaid-source { display: none; }

            /* Other styles for controls, complexity etc. */
            ${ this.getStylesForControls(context, complexityConfig, functionComplexity) }
        </style>
    </head>
    <body>
        ${ this.getHtmlForControls(context, functionComplexity) }

        <div id="container">
            <div class="mermaid">${flowchartSyntax}</div>
        </div>
        <div id="mermaid-source">${flowchartSyntax.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>

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
                }
            });


            // Enhanced error handling for different environments
            function initializeMermaid() {
                try {
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
                } catch (error) {
                    console.warn('Mermaid initialization error:', error);
                    // Try with more basic configuration for compatibility
                    try {
                        mermaid.initialize({
                            startOnLoad: true,
                            theme: '${theme}',
                            securityLevel: 'loose'
                        });
                    } catch (fallbackError) {
                        console.error('Mermaid fallback initialization failed:', fallbackError);
                    }
                }
            }

            // Initialize mermaid with error handling
            if (typeof mermaid !== 'undefined') {
                initializeMermaid();
            } else {
                console.error('Mermaid library not loaded');
            }

            function setupInteractions(svgElement) {
                if (!svgElement) return;

                const panZoomInstance = svgPanZoom(svgElement, {
                    zoomEnabled: true,
                    controlIconsEnabled: true,
                    fit: true,
                    center: true,
                    minZoom: 0.1,
                    maxZoom: 10,
                    zoomScaleSensitivity: 0.2
                });

                // Parse edge metadata from mermaid source comments
                function parseEdgeMetadata() {
                    const mermaidSource = document.getElementById('mermaid-source').textContent;
                    const edgeMetadata = new Map();
                    
                    const lines = mermaidSource.split('\\n');
                    for (const line of lines) {
                        const match = line.match(/%% EDGE_META:([^:]+):([^:]+)/);
                        if (match) {
                            const [, source, target] = match;
                            if (!edgeMetadata.has(source)) {
                                edgeMetadata.set(source, []);
                            }
                            edgeMetadata.get(source).push(target);
                        }
                    }
                    return edgeMetadata;
                }

                function extractBaseId(fullNodeId) {
                    if (!fullNodeId) return '';
                    // Remove flowchart prefix and suffix numbers
                    let base = fullNodeId.startsWith('flowchart-') 
                        ? fullNodeId.replace(/^flowchart-/, '') 
                        : fullNodeId;
                    base = base.replace(/-[\\d-]+$/, '');
                    return base;
                }

                function findOutgoingEdges(fullNodeId, edgeMetadata) {
                    const baseId = extractBaseId(fullNodeId);
                    if (!baseId) return [];

                    const outgoingEdges = [];
                    const targets = edgeMetadata.get(baseId) || [];
                    
                    // Look for edges with IDs that contain the source->target relationship
                    for (const target of targets) {
                        const edgePatterns = [
                            "L_" + baseId + "_" + target + "_",
                            baseId + "_" + target,
                            baseId + "-" + target,
                            "edge_" + baseId + "_" + target
                        ];
                        
                        for (const pattern of edgePatterns) {
                            const matchingEdge = document.querySelector('[id*="' + pattern + '"]');
                            if (matchingEdge) {
                                outgoingEdges.push(matchingEdge);
                                break;
                            }
                        }
                    }
                    return outgoingEdges;
                }

                function findConnectedNodes(baseId, edgeMetadata) {
                    const targets = edgeMetadata.get(baseId) || [];
                    const connectedNodes = [];
                    
                    for (const targetBaseId of targets) {
                        // Try multiple patterns to find target nodes
                        const patterns = [
                            '[id*="' + targetBaseId + '"]',
                            '#flowchart-' + targetBaseId + '-',
                            '[id^="flowchart-' + targetBaseId + '"]'
                        ];
                        
                        for (const pattern of patterns) {
                            const targetNode = document.querySelector(pattern);
                            if (targetNode && !connectedNodes.includes(targetNode)) {
                                connectedNodes.push(targetNode);
                                break;
                            }
                        }
                    }
                    return connectedNodes;
                }

                // Parse edge metadata once
                const edgeMetadata = parseEdgeMetadata();

                const allNodes = svgElement.querySelectorAll('.node');
                allNodes.forEach((node) => {
                    const fullNodeId = node.id;
                    if (!fullNodeId) return;

                    node.addEventListener('mouseenter', (event) => {
                        event.stopPropagation();
                        node.classList.add('hover-highlight');

                        const baseId = extractBaseId(fullNodeId);
                        
                        const outgoingEdges = findOutgoingEdges(fullNodeId, edgeMetadata);
                        outgoingEdges.forEach(edge => {
                            edge.classList.add('hover-highlight');
                        });

                        const connectedNodes = findConnectedNodes(baseId, edgeMetadata);
                        connectedNodes.forEach(connectedNode => {
                            connectedNode.classList.add('child-highlight');
                        });
                    });

                    node.addEventListener('mouseleave', () => {
                        document.querySelectorAll('.hover-highlight, .child-highlight').forEach(el => {
                            el.classList.remove('hover-highlight', 'child-highlight');
                        });
                    });
                });
            }

            window.addEventListener('load', () => {
                setTimeout(() => {
                    const svgElement = document.querySelector('.mermaid svg');
                    if (svgElement) {
                        setupInteractions(svgElement);
                    } else {
                        console.error('[Visor] SVG element for flowchart not found after initial load!');
                    }
                }, 200);

            });

            function setupButtonHandlers() {
                const copyBtn = document.getElementById('copy-mermaid');
                if (copyBtn) {
                    copyBtn.addEventListener('click', () => {
                        const source = document.getElementById('mermaid-source').textContent;
                        vscode.postMessage({ command: 'copyMermaid', payload: { code: source } });
                    });
                }
                const exportSvgBtn = document.getElementById('export-svg');
                if(exportSvgBtn) exportSvgBtn.addEventListener('click', () => exportFlowchart('svg'));
                
                const exportPngBtn = document.getElementById('export-png');
                if(exportPngBtn) exportPngBtn.addEventListener('click', () => exportFlowchart('png'));

                const openPanelBtn = document.getElementById('open-panel-btn');
                if (openPanelBtn) {
                    openPanelBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'openInPanel', payload: {} });
                    });
                }

                // Complexity toggle functionality
                const complexityToggle = document.getElementById('complexity-toggle');
                const complexityPanel = document.getElementById('complexity-panel');
                if (complexityToggle && complexityPanel) {
                    // Use a simple variable since localStorage is not supported in artifacts
                    let isHidden = false;
                    
                    function updateToggleState() {
                        if (isHidden) {
                            complexityPanel.classList.add('hidden');
                            complexityToggle.textContent = '📊';
                            complexityToggle.title = 'Show complexity display';
                        } else {
                            complexityPanel.classList.remove('hidden');
                            complexityToggle.textContent = '📊✓';
                            complexityToggle.title = 'Hide complexity display';
                        }
                    }
                    
                    updateToggleState(); // Set initial state
                    
                    complexityToggle.addEventListener('click', () => {
                        isHidden = !isHidden;
                        updateToggleState();
                    });
                }
            }
            setupButtonHandlers();

            /**
             * Handles exporting the flowchart to SVG or PNG.
             * It generates a clean SVG from the source to ensure no UI controls are included.
             */
            async function exportFlowchart(fileType) {
                try {
                    const mermaidSourceElement = document.getElementById('mermaid-source');
                    if (!mermaidSourceElement || !mermaidSourceElement.textContent) {
                        throw new Error("Could not find Mermaid source code to export.");
                    }

                    const mermaidSource = mermaidSourceElement.textContent
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&amp;/g, '&')
                        .trim();
                    
                    const { svg } = await mermaid.render('export-svg-element', mermaidSource);
                    
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

                    cleanSvgElement.setAttribute('width', finalWidth.toString());
                    cleanSvgElement.setAttribute('height', finalHeight.toString());
                    cleanSvgElement.setAttribute('viewBox', \`\${finalX} \${finalY} \${finalWidth} \${finalHeight}\`);

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
                    } else if (fileType === 'png') {
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
                            const pngData = canvas.toDataURL('image/png').split(',')[1];
                            vscode.postMessage({
                                command: 'export',
                                payload: { fileType: 'png', data: pngData }
                            });
                        };
                        img.onerror = function() {
                            throw new Error("SVG to PNG conversion failed (image load error).");
                        };
                        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(finalSvgData);
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown export error';
                    vscode.postMessage({
                        command: 'exportError',
                        payload: { error: 'Export failed: ' + errorMessage }
                    });
                }
            }
        </script>
    </body>
    </html>`;
}

  /**
   * Helper to generate CSS for controls to keep getWebviewContent cleaner.
   */
  private getStylesForControls(context: any, complexityConfig: any, functionComplexity: any): string {
      return `
        #panel-controls {
            position: fixed; top: 10px; left: 10px; right: 10px; z-index: 1000;
            display: flex; justify-content: space-between; align-items: center;
            padding: 10px 16px; background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border); border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        #export-controls {
            position: ${context.isPanel ? "relative" : "absolute"};
            ${context.isPanel ? "" : "top: 10px; right: 10px;"}
            z-index: 1000; display: flex; gap: 10px;
        }
        #export-controls button, #open-panel-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: 1px solid var(--vscode-button-border, transparent);
            padding: 5px 10px; cursor: pointer; border-radius: 4px; font-size: 11px;
        }
        #export-controls button:hover, #open-panel-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        /* Container for complexity panel and toggle button, positioned bottom-left */
        #complexity-container {
            position: fixed; bottom: 10px; left: 10px; z-index: 1001;
            display: flex; align-items: flex-end; gap: 8px;
        }

        /* Complexity display panel - layout within the container */
        #complexity-panel {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 6px; padding: 8px 12px; font-size: 12px;
            color: var(--vscode-editor-foreground);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); max-width: 300px;
            transition: opacity 0.3s ease;
        }
        
        #complexity-panel.hidden { display: none; }
        
        /* Complexity toggle button - layout within the container */
        #complexity-toggle {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: 1px solid var(--vscode-button-border, transparent);
            padding: 6px 10px; cursor: pointer; border-radius: 4px; font-size: 11px;
            flex-shrink: 0; /* Prevents the button from shrinking */
        }
        
        #complexity-toggle:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .complexity-rating { font-weight: bold; margin-left: 4px; }
        .complexity-low { color: ${complexityConfig.colors.low}; }
        .complexity-medium { color: ${complexityConfig.colors.medium}; }
        .complexity-high { color: ${complexityConfig.colors.high}; }
        .complexity-very-high { color: ${complexityConfig.colors.veryHigh}; }
        
        .complexity-description {
            margin-top: 4px; font-size: 11px; opacity: 0.8;
        }
      `;
  }

  /**
   * Helper to generate HTML for controls.
   */
  private getHtmlForControls(context: any, functionComplexity: any): string {
    const panelControls = `
        <div id="panel-controls">
            <div>Flowchart Viewer</div>
            <div id="export-controls">
                <button id="copy-mermaid" title="Copy Mermaid Code">Copy Code</button>
                <button id="export-svg" title="Export as SVG">💾 SVG</button>
                <button id="export-png" title="Export as PNG">🖼️ PNG</button>
            </div>
        </div>
    `;

    const sidebarControls = `
        <div id="export-controls">
            ${context.showPanelButton ? '<button id="open-panel-btn">🚀 Open in New Window</button>' : ''}
            <button id="copy-mermaid" title="Copy Mermaid Code">Copy Code</button>
            <button id="export-svg">Export as SVG</button>
            <button id="export-png">Export as PNG</button>
        </div>
        ${
          functionComplexity ? `
        <div id="complexity-container">
            <button id="complexity-toggle" title="Toggle complexity display">📊</button>
            <div id="complexity-panel">
                <div>
                    <strong>Cyclomatic Complexity:</strong> 
                    ${functionComplexity.cyclomaticComplexity}
                    <span class="complexity-rating complexity-${functionComplexity.rating}">
                        (${functionComplexity.rating.toUpperCase()})
                    </span>
                </div>
                <div class="complexity-description">
                    ${functionComplexity.description}
                </div>
            </div>
        </div>
        ` : ""
        }
    `;
    
    return context.isPanel ? panelControls : sidebarControls;
  }

  /**
   * Generates a simple HTML page to show a loading or informational message.
   */
  protected getLoadingHtml(message: string): string {
    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body, html {
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
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
  protected getNonce(): string {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  /**
   * Cleans up disposables when the provider is disposed.
   */
  public dispose(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._currentDocument = undefined;
    this._currentPosition = undefined;
    this._isUpdating = false;
    this._locationMap = [];
    this._currentFunctionRange = undefined;
    this._eventListenersSetup = false;

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}