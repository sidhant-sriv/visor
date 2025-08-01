import * as vscode from 'vscode';
import { initPythonLanguageService } from './python';

/**
 * Initializes all language services for the extension.
 */
export async function initLanguageServices(context: vscode.ExtensionContext) {
    // Construct the path to the python wasm file and initialize the service
    const pythonWasmPath = vscode.Uri.joinPath(context.extensionUri, 'dist', 'tree-sitter-python.wasm').fsPath;
    initPythonLanguageService(pythonWasmPath);

    // Future languages can be initialized here
    // const javaWasmPath = vscode.Uri.joinPath(context.extensionUri, 'dist', 'tree-sitter-java.wasm').fsPath;
    // initJavaLanguageService(javaWasmPath);
}
