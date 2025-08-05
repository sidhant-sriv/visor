import * as vscode from "vscode";
import { initPythonLanguageService } from "./python";
import { initTypeScriptLanguageService } from "./typescript";
import { initJavaLanguageService } from "./java";
import { initCppLanguageService } from "./cpp";
import { initCLanguageService } from "./c";

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

  // Initialize C++ language service
  const cppWasmPath = vscode.Uri.joinPath(
    context.extensionUri,
    "dist",
    "tree-sitter-cpp.wasm"
  ).fsPath;
  initCppLanguageService(cppWasmPath);

  // Initialize C language service
  const cWasmPath = vscode.Uri.joinPath(
    context.extensionUri,
    "dist",
    "tree-sitter-c.wasm"
  ).fsPath;
  initCLanguageService(cWasmPath);
}
