import * as vscode from 'vscode';
import { FlowchartViewProvider } from './view/FlowchartViewProvider';
import { initPythonLanguageService } from './logic/language-services/python';

/**
 * The main entry point for the extension. This function is called by VS Code when
 * the extension is activated.
 */
export async function activate(context: vscode.ExtensionContext) {
    console.log('SidVis extension is now active!');

    try {
        // Construct the path to the wasm file and initialize the Python parser
        const wasmPath = vscode.Uri.joinPath(context.extensionUri, 'dist', 'tree-sitter-python.wasm').fsPath;
        await initPythonLanguageService(wasmPath);
        console.log('Python parser initialized successfully.');
    } catch (error) {
        console.error('Failed to initialize Python parser:', error);
        vscode.window.showErrorMessage('SidVis: Failed to load Python parser. Flowcharts for Python will not be available.');
    }

    const provider = new FlowchartViewProvider(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(FlowchartViewProvider.viewType, provider)
    );
}

/**
 * This function is called when the extension is deactivated.
 */
export function deactivate() {}
