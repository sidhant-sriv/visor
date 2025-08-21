import * as vscode from "vscode";

let ctx: vscode.ExtensionContext | undefined;

export function setExtensionContext(context: vscode.ExtensionContext) {
  ctx = context;
}

export function getExtensionContext(): vscode.ExtensionContext | undefined {
  return ctx;
}


