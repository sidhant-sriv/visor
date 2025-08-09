import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;
let shown = false;

function getChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("Visor LLM");
    // Show the output channel the first time we log, to aid debugging
    if (!shown) {
      channel.show(true);
      shown = true;
    }
  }
  return channel;
}

export function logInfo(message: string): void {
  getChannel().appendLine(`[INFO] ${message}`);
}

export function logWarn(message: string): void {
  getChannel().appendLine(`[WARN] ${message}`);
}

export function logError(message: string): void {
  getChannel().appendLine(`[ERROR] ${message}`);
}


