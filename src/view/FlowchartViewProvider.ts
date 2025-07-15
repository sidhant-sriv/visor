import * as vscode from 'vscode';
import { analyzeTypeScriptCode } from '../logic/analyzer';

const MERMAID_VERSION = '10.9.1';
const SVG_PAN_ZOOM_VERSION = '3.6.1';

/**
 * Generates the complete HTML content for the webview panel.
 * This includes the Mermaid.js library and the generated flowchart syntax.
 */
function getWebviewContent(flowchartSyntax: string, nonce: string): string {
    const theme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? 'dark' : 'default';
    
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
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
        </style>
    </head>
    <body>
        <div id="container">
            <div class="mermaid">
${flowchartSyntax}
            </div>
        </div>
        <script nonce="${nonce}">
            mermaid.initialize({ 
                startOnLoad: true, 
                theme: '${theme}',
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
        </script>
    </body>
    </html>`;
}

export class FlowchartViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'sidvis.flowchartView';
    private _view?: vscode.WebviewView;
    private _disposables: vscode.Disposable[] = [];

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        this.updateView(vscode.window.activeTextEditor);

        vscode.window.onDidChangeActiveTextEditor(editor => {
            this.updateView(editor);
        }, null, this._disposables);

        vscode.window.onDidChangeTextEditorSelection(event => {
            if (event.textEditor === vscode.window.activeTextEditor) {
                this.updateView(event.textEditor);
            }
        }, null, this._disposables);
    }

    private updateView(editor: vscode.TextEditor | undefined) {
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
        const flowchartSyntax = analyzeTypeScriptCode(document.getText(), position);

        this._view.webview.html = getWebviewContent(flowchartSyntax, this.getNonce());
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
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
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