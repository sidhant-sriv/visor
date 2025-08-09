import * as vscode from "vscode";

/**
 * Utility class to detect the VS Code-based editor environment
 * and handle compatibility differences between VS Code, Cursor, and Windsurf
 */
export class EnvironmentDetector {
  private static _detectionResult: EditorEnvironment | null = null;

  /**
   * Detect which VS Code-based editor is running
   */
  public static detectEnvironment(): EditorEnvironment {
    if (this._detectionResult) {
      return this._detectionResult;
    }

    const appName = vscode.env.appName?.toLowerCase() || "";
    const appHost = vscode.env.appHost?.toLowerCase() || "";
    const userAgent = (globalThis as any)?.navigator?.userAgent?.toLowerCase() || "";
    
    let editor: "vscode" | "cursor" | "windsurf" | "unknown" = "unknown";
    
    // Detect Cursor
    if (
      appName.includes("cursor") || 
      appHost.includes("cursor") ||
      userAgent.includes("cursor") ||
      process.env.VSCODE_CWD?.includes("Cursor") ||
      process.env.VSCODE_PORTABLE?.includes("Cursor")
    ) {
      editor = "cursor";
    }
    // Detect Windsurf
    else if (
      appName.includes("windsurf") || 
      appHost.includes("windsurf") ||
      userAgent.includes("windsurf") ||
      process.env.VSCODE_CWD?.includes("Windsurf") ||
      process.env.VSCODE_PORTABLE?.includes("Windsurf")
    ) {
      editor = "windsurf";
    }
    // Detect VS Code
    else if (
      appName.includes("visual studio code") || 
      appName.includes("vscode") ||
      appHost.includes("vscode")
    ) {
      editor = "vscode";
    }

    this._detectionResult = {
      editor,
      appName: vscode.env.appName,
      appHost: vscode.env.appHost,
      isVSCode: editor === "vscode",
      isCursor: editor === "cursor",
      isWindsurf: editor === "windsurf",
      requiresCompatibilityMode: editor === "cursor" || editor === "windsurf"
    };

    console.log("Environment detected:", this._detectionResult);
    return this._detectionResult;
  }

  /**
   * Get specific webview options based on the detected environment
   */
  public static getWebviewOptions(baseOptions: vscode.WebviewOptions): vscode.WebviewOptions {
    const env = this.detectEnvironment();
    
    const options = { ...baseOptions };
    
    if (env.requiresCompatibilityMode) {
      // For Cursor/Windsurf, be more conservative with webview options
      options.enableCommandUris = true; // Explicitly enable command URIs
      options.enableForms = false; // Disable forms to avoid issues
      
      // Ensure local resource roots are properly set
      if (!options.localResourceRoots) {
        options.localResourceRoots = [];
      }
    }
    
    return options;
  }

  /**
   * Get Content Security Policy adjusted for the environment
   */
  public static getContentSecurityPolicy(nonce: string): string {
    const env = this.detectEnvironment();
    
    // Base CSP that should work in all environments
    let csp = `default-src 'none'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https:; font-src https://cdn.jsdelivr.net;`;
    
    if (env.requiresCompatibilityMode) {
      // For Cursor/Windsurf, add more permissive policies for compatibility
      csp = `default-src 'none'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net 'unsafe-eval'; style-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https: blob:; font-src https://cdn.jsdelivr.net data:; connect-src https: wss: ws:;`;
    }
    
    return csp;
  }

  /**
   * Get webview panel options adjusted for the environment
   */
  public static getWebviewPanelOptions(baseOptions: vscode.WebviewPanelOptions & vscode.WebviewOptions): vscode.WebviewPanelOptions & vscode.WebviewOptions {
    const env = this.detectEnvironment();
    const options = { ...baseOptions };
    
    if (env.requiresCompatibilityMode) {
      // For Cursor/Windsurf, adjust panel behavior
      options.retainContextWhenHidden = true; // Always retain context for stability
      options.enableFindWidget = true; // Ensure find widget is enabled
    }
    
    return this.getWebviewOptions(options);
  }

  /**
   * Check if we need to apply compatibility workarounds
   */
  public static needsCompatibilityMode(): boolean {
    return this.detectEnvironment().requiresCompatibilityMode;
  }

  /**
   * Get environment-specific initialization delay
   */
  public static getInitializationDelay(): number {
    const env = this.detectEnvironment();
    
    // Cursor and Windsurf might need slightly longer initialization times
    return env.requiresCompatibilityMode ? 100 : 0;
  }
}

export interface EditorEnvironment {
  editor: "vscode" | "cursor" | "windsurf" | "unknown";
  appName: string;
  appHost: string;
  isVSCode: boolean;
  isCursor: boolean;
  isWindsurf: boolean;
  requiresCompatibilityMode: boolean;
}