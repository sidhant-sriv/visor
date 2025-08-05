import * as vscode from "vscode";
import { initPythonLanguageService } from "./python";
import { initTypeScriptLanguageService } from "./typescript";
import { initJavaLanguageService } from "./java";
import { initCppLanguageService } from "./cpp";
import { initCLanguageService } from "./c";
import { initRustLanguageService } from "./rust";

/**
 * Initializes all language services for the extension.
 */
export async function initLanguageServices(context: vscode.ExtensionContext) {
  const services = [
    {
      name: "Python",
      init: async () => {
        const pythonWasmPath = vscode.Uri.joinPath(
          context.extensionUri,
          "dist",
          "tree-sitter-python.wasm"
        ).fsPath;
        await initPythonLanguageService(pythonWasmPath);
      },
    },
    {
      name: "TypeScript",
      init: async () => {
        const typescriptWasmPath = vscode.Uri.joinPath(
          context.extensionUri,
          "dist",
          "tree-sitter-typescript.wasm"
        ).fsPath;
        await initTypeScriptLanguageService(typescriptWasmPath);
      },
    },
    {
      name: "Java",
      init: async () => {
        const javaWasmPath = vscode.Uri.joinPath(
          context.extensionUri,
          "dist",
          "tree-sitter-java.wasm"
        ).fsPath;
        await initJavaLanguageService(javaWasmPath);
      },
    },
    {
      name: "C++",
      init: async () => {
        const cppWasmPath = vscode.Uri.joinPath(
          context.extensionUri,
          "dist",
          "tree-sitter-cpp.wasm"
        ).fsPath;
        await initCppLanguageService(cppWasmPath);
      },
    },
    {
      name: "C",
      init: async () => {
        const cWasmPath = vscode.Uri.joinPath(
          context.extensionUri,
          "dist",
          "tree-sitter-c.wasm"
        ).fsPath;
        await initCLanguageService(cWasmPath);
      },
    },
    {
      name: "Rust",
      init: async () => {
        const rustWasmPath = vscode.Uri.joinPath(
          context.extensionUri,
          "dist",
          "tree-sitter-rust.wasm"
        ).fsPath;
        await initRustLanguageService(rustWasmPath);
      },
    },
  ];

  for (const service of services) {
    try {
      console.log(`Initializing ${service.name} language service...`);
      await service.init();
      console.log(`${service.name} language service initialized successfully`);
    } catch (error) {
      console.error(
        `Failed to initialize ${service.name} language service:`,
        error
      );
      throw new Error(
        `Failed to initialize ${service.name} language service: ${error}`
      );
    }
  }
}
