import * as vscode from "vscode";
import { initPythonLanguageService } from "./python";
import { initTypeScriptLanguageService } from "./typescript";
import { initJavaLanguageService } from "./java";

/**
 * Initializes all language services for the extension.
 */
export async function initLanguageServices(context: vscode.ExtensionContext) {
  // Construct the path to the python wasm file and initialize the service
  const pythonWasmPath = vscode.Uri.joinPath(
    context.extensionUri,
    "dist",
    "tree-sitter-python.wasm"
  ).fsPath;
  initPythonLanguageService(pythonWasmPath);

  // Initialize TypeScript language service
  const typescriptWasmPath = vscode.Uri.joinPath(
    context.extensionUri,
    "dist",
    "tree-sitter-typescript.wasm"
  ).fsPath;
  initTypeScriptLanguageService(typescriptWasmPath);

  // Initialize Java language service
  const javaWasmPath = vscode.Uri.joinPath(
    context.extensionUri,
    "dist",
    "tree-sitter-java.wasm"
  ).fsPath;
  initJavaLanguageService(javaWasmPath);
}
