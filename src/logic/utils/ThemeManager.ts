import { NodeType } from "../../ir/ir";

// Unchanged interfaces
export interface NodeStyle {
  shape: "rect" | "diamond" | "round" | "stadium";
  borderStyle: "solid" | "dashed" | "dotted" | "double";
  fontWeight: "normal" | "medium" | "bold";
  emphasis: "low" | "medium" | "high";
}

export interface ThemeColorPalette {
  fill: string;
  stroke: string;
  textColor?: string;
}

export interface ThemeStyles {
  entry: ThemeColorPalette;
  exit: ThemeColorPalette;
  process: ThemeColorPalette;
  decision: ThemeColorPalette;
  loop: ThemeColorPalette;
  exception: ThemeColorPalette;
  assignment: ThemeColorPalette;
  functionCall: ThemeColorPalette;
  asyncOperation: ThemeColorPalette;
  breakContinue: ThemeColorPalette;
  returnNode: ThemeColorPalette;
}

// NEW: A structure to define a complete theme with light and dark variants
export interface Theme {
  name: string; // User-friendly name for settings
  light: ThemeStyles;
  dark: ThemeStyles;
}

export class SubtleThemeManager {
  // The style registry for shapes and borders.
  // UPDATED: Changed ENTRY and EXIT nodes to be round.
  private static readonly nodeStyleRegistry = new Map<NodeType, NodeStyle>([
    [
      NodeType.ENTRY,
      {
        shape: "round",
        borderStyle: "solid",
        fontWeight: "normal",
        emphasis: "low",
      },
    ],
    [
      NodeType.EXIT,
      {
        shape: "round",
        borderStyle: "solid",
        fontWeight: "normal",
        emphasis: "low",
      },
    ],
    [
      NodeType.PROCESS,
      {
        shape: "rect",
        borderStyle: "solid",
        fontWeight: "normal",
        emphasis: "low",
      },
    ],
    [
      NodeType.DECISION,
      {
        shape: "diamond",
        borderStyle: "solid",
        fontWeight: "normal",
        emphasis: "low",
      },
    ],
    [
      NodeType.LOOP_START,
      {
        shape: "rect",
        borderStyle: "solid",
        fontWeight: "normal",
        emphasis: "low",
      },
    ],
    [
      NodeType.LOOP_END,
      {
        shape: "rect",
        borderStyle: "solid",
        fontWeight: "normal",
        emphasis: "low",
      },
    ],
    [
      NodeType.EXCEPTION,
      {
        shape: "rect",
        borderStyle: "solid",
        fontWeight: "normal",
        emphasis: "low",
      },
    ],
    [
      NodeType.BREAK_CONTINUE,
      {
        shape: "rect",
        borderStyle: "solid",
        fontWeight: "normal",
        emphasis: "low",
      },
    ],
    [
      NodeType.FUNCTION_CALL,
      {
        shape: "rect",
        borderStyle: "solid",
        fontWeight: "normal",
        emphasis: "low",
      },
    ],
    [
      NodeType.ASSIGNMENT,
      {
        shape: "rect",
        borderStyle: "solid",
        fontWeight: "normal",
        emphasis: "low",
      },
    ],
    [
      NodeType.RETURN,
      {
        shape: "rect",
        borderStyle: "solid",
        fontWeight: "normal",
        emphasis: "low",
      },
    ],
    [
      NodeType.ASYNC_OPERATION,
      {
        shape: "rect",
        borderStyle: "solid",
        fontWeight: "normal",
        emphasis: "low",
      },
    ],
  ]);

  // A registry to hold all available themes
  private static readonly themeRegistry = new Map<string, Theme>([
    [
      "monokai",
      {
        name: "Monokai",
        dark: {
          entry: { fill: "#272822", stroke: "#A6E22E", textColor: "#F8F8F2" },
          exit: { fill: "#272822", stroke: "#A6E22E", textColor: "#F8F8F2" },
          process: { fill: "#272822", stroke: "#66D9EF", textColor: "#F8F8F2" },
          decision: {
            fill: "#272822",
            stroke: "#E6DB74",
            textColor: "#F8F8F2",
          },
          loop: { fill: "#272822", stroke: "#AE81FF", textColor: "#F8F8F2" },
          exception: {
            fill: "#272822",
            stroke: "#F92672",
            textColor: "#F8F8F2",
          },
          assignment: {
            fill: "#272822",
            stroke: "#5299d8",
            textColor: "#F8F8F2",
          },
          functionCall: {
            fill: "#272822",
            stroke: "#FD971F",
            textColor: "#F8F8F2",
          },
          asyncOperation: {
            fill: "#272822",
            stroke: "#AE81FF",
            textColor: "#F8F8F2",
          },
          breakContinue: {
            fill: "#272822",
            stroke: "#F92672",
            textColor: "#F8F8F2",
          },
          returnNode: {
            fill: "#272822",
            stroke: "#FD971F",
            textColor: "#F8F8F2",
          },
        },
        light: {
          entry: { fill: "#f0f0f0", stroke: "#7fb42b", textColor: "#2d2d2d" },
          exit: { fill: "#f0f0f0", stroke: "#7fb42b", textColor: "#2d2d2d" },
          process: { fill: "#f0f0f0", stroke: "#3ab1cf", textColor: "#2d2d2d" },
          decision: {
            fill: "#f0f0f0",
            stroke: "#d9a100",
            textColor: "#2d2d2d",
          },
          loop: { fill: "#f0f0f0", stroke: "#996ae6", textColor: "#2d2d2d" },
          exception: {
            fill: "#f0f0f0",
            stroke: "#e61a64",
            textColor: "#2d2d2d",
          },
          assignment: {
            fill: "#f0f0f0",
            stroke: "#3973ab",
            textColor: "#2d2d2d",
          },
          functionCall: {
            fill: "#f0f0f0",
            stroke: "#f0750c",
            textColor: "#2d2d2d",
          },
          asyncOperation: {
            fill: "#f0f0f0",
            stroke: "#996ae6",
            textColor: "#2d2d2d",
          },
          breakContinue: {
            fill: "#f0f0f0",
            stroke: "#e61a64",
            textColor: "#2d2d2d",
          },
          returnNode: {
            fill: "#f0f0f0",
            stroke: "#f0750c",
            textColor: "#2d2d2d",
          },
        },
      },
    ],
    [
      "github",
      {
        name: "GitHub",
        dark: {
          entry: { fill: "#0d1117", stroke: "#7c3aed", textColor: "#f0f6fc" },
          exit: { fill: "#0d1117", stroke: "#7c3aed", textColor: "#f0f6fc" },
          process: { fill: "#0d1117", stroke: "#58a6ff", textColor: "#f0f6fc" },
          decision: {
            fill: "#0d1117",
            stroke: "#f2cc60",
            textColor: "#f0f6fc",
          },
          loop: { fill: "#0d1117", stroke: "#a5a5a5", textColor: "#f0f6fc" },
          exception: {
            fill: "#0d1117",
            stroke: "#f85149",
            textColor: "#f0f6fc",
          },
          assignment: {
            fill: "#0d1117",
            stroke: "#79c0ff",
            textColor: "#f0f6fc",
          },
          functionCall: {
            fill: "#0d1117",
            stroke: "#ff7b72",
            textColor: "#f0f6fc",
          },
          asyncOperation: {
            fill: "#0d1117",
            stroke: "#d2a8ff",
            textColor: "#f0f6fc",
          },
          breakContinue: {
            fill: "#0d1117",
            stroke: "#ffa657",
            textColor: "#f0f6fc",
          },
          returnNode: {
            fill: "#0d1117",
            stroke: "#3fb950",
            textColor: "#f0f6fc",
          },
        },
        light: {
          entry: { fill: "#ffffff", stroke: "#8250df", textColor: "#24292f" },
          exit: { fill: "#ffffff", stroke: "#8250df", textColor: "#24292f" },
          process: { fill: "#ffffff", stroke: "#0969da", textColor: "#24292f" },
          decision: {
            fill: "#ffffff",
            stroke: "#9a6700",
            textColor: "#24292f",
          },
          loop: { fill: "#ffffff", stroke: "#656d76", textColor: "#24292f" },
          exception: {
            fill: "#ffffff",
            stroke: "#cf222e",
            textColor: "#24292f",
          },
          assignment: {
            fill: "#ffffff",
            stroke: "#2188ff",
            textColor: "#24292f",
          },
          functionCall: {
            fill: "#ffffff",
            stroke: "#a40e26",
            textColor: "#24292f",
          },
          asyncOperation: {
            fill: "#ffffff",
            stroke: "#8250df",
            textColor: "#24292f",
          },
          breakContinue: {
            fill: "#ffffff",
            stroke: "#bc4c00",
            textColor: "#24292f",
          },
          returnNode: {
            fill: "#ffffff",
            stroke: "#1a7f37",
            textColor: "#24292f",
          },
        },
      },
    ],
    [
      "solarized",
      {
        name: "Solarized",
        dark: {
          entry: { fill: "#002b36", stroke: "#6c71c4", textColor: "#839496" },
          exit: { fill: "#002b36", stroke: "#6c71c4", textColor: "#839496" },
          process: { fill: "#002b36", stroke: "#268bd2", textColor: "#839496" },
          decision: {
            fill: "#002b36",
            stroke: "#b58900",
            textColor: "#839496",
          },
          loop: { fill: "#002b36", stroke: "#2aa198", textColor: "#839496" },
          exception: {
            fill: "#002b36",
            stroke: "#dc322f",
            textColor: "#839496",
          },
          assignment: {
            fill: "#002b36",
            stroke: "#d33682",
            textColor: "#839496",
          },
          functionCall: {
            fill: "#002b36",
            stroke: "#cb4b16",
            textColor: "#839496",
          },
          asyncOperation: {
            fill: "#002b36",
            stroke: "#d33682",
            textColor: "#839496",
          },
          breakContinue: {
            fill: "#002b36",
            stroke: "#cb4b16",
            textColor: "#839496",
          },
          returnNode: {
            fill: "#002b36",
            stroke: "#859900",
            textColor: "#839496",
          },
        },
        light: {
          entry: { fill: "#fdf6e3", stroke: "#6c71c4", textColor: "#657b83" },
          exit: { fill: "#fdf6e3", stroke: "#6c71c4", textColor: "#657b83" },
          process: { fill: "#fdf6e3", stroke: "#268bd2", textColor: "#657b83" },
          decision: {
            fill: "#fdf6e3",
            stroke: "#b58900",
            textColor: "#657b83",
          },
          loop: { fill: "#fdf6e3", stroke: "#2aa198", textColor: "#657b83" },
          exception: {
            fill: "#fdf6e3",
            stroke: "#dc322f",
            textColor: "#657b83",
          },
          assignment: {
            fill: "#fdf6e3",
            stroke: "#d33682",
            textColor: "#657b83",
          },
          functionCall: {
            fill: "#fdf6e3",
            stroke: "#cb4b16",
            textColor: "#657b83",
          },
          asyncOperation: {
            fill: "#fdf6e3",
            stroke: "#d33682",
            textColor: "#657b83",
          },
          breakContinue: {
            fill: "#fdf6e3",
            stroke: "#cb4b16",
            textColor: "#657b83",
          },
          returnNode: {
            fill: "#fdf6e3",
            stroke: "#859900",
            textColor: "#657b83",
          },
        },
      },
    ],
    [
      "one-dark-pro",
      {
        name: "One Dark Pro",
        dark: {
          entry: { fill: "#282c34", stroke: "#c678dd", textColor: "#abb2bf" },
          exit: { fill: "#282c34", stroke: "#c678dd", textColor: "#abb2bf" },
          process: { fill: "#282c34", stroke: "#61afef", textColor: "#abb2bf" },
          decision: {
            fill: "#282c34",
            stroke: "#e5c07b",
            textColor: "#abb2bf",
          },
          loop: { fill: "#282c34", stroke: "#56b6c2", textColor: "#abb2bf" },
          exception: {
            fill: "#282c34",
            stroke: "#e06c75",
            textColor: "#abb2bf",
          },
          assignment: {
            fill: "#282c34",
            stroke: "#528bff",
            textColor: "#abb2bf",
          },
          functionCall: {
            fill: "#282c34",
            stroke: "#d19a66",
            textColor: "#abb2bf",
          },
          asyncOperation: {
            fill: "#282c34",
            stroke: "#c678dd",
            textColor: "#abb2bf",
          },
          breakContinue: {
            fill: "#282c34",
            stroke: "#e06c75",
            textColor: "#abb2bf",
          },
          returnNode: {
            fill: "#282c34",
            stroke: "#98c379",
            textColor: "#abb2bf",
          },
        },
        light: {
          entry: { fill: "#fafafa", stroke: "#a626a4", textColor: "#383a42" },
          exit: { fill: "#fafafa", stroke: "#a626a4", textColor: "#383a42" },
          process: { fill: "#fafafa", stroke: "#4078f2", textColor: "#383a42" },
          decision: {
            fill: "#fafafa",
            stroke: "#c18401",
            textColor: "#383a42",
          },
          loop: { fill: "#fafafa", stroke: "#0184bc", textColor: "#383a42" },
          exception: {
            fill: "#fafafa",
            stroke: "#e45649",
            textColor: "#383a42",
          },
          assignment: {
            fill: "#fafafa",
            stroke: "#2962ff",
            textColor: "#383a42",
          },
          functionCall: {
            fill: "#fafafa",
            stroke: "#986801",
            textColor: "#383a42",
          },
          asyncOperation: {
            fill: "#fafafa",
            stroke: "#a626a4",
            textColor: "#383a42",
          },
          breakContinue: {
            fill: "#fafafa",
            stroke: "#e45649",
            textColor: "#383a42",
          },
          returnNode: {
            fill: "#fafafa",
            stroke: "#50a14f",
            textColor: "#383a42",
          },
        },
      },
    ],
    [
      "dracula",
      {
        name: "Dracula",
        dark: {
          entry: { fill: "#282a36", stroke: "#bd93f9", textColor: "#f8f8f2" },
          exit: { fill: "#282a36", stroke: "#bd93f9", textColor: "#f8f8f2" },
          process: { fill: "#282a36", stroke: "#8be9fd", textColor: "#f8f8f2" },
          decision: {
            fill: "#282a36",
            stroke: "#f1fa8c",
            textColor: "#f8f8f2",
          },
          loop: { fill: "#282a36", stroke: "#50fa7b", textColor: "#f8f8f2" },
          exception: {
            fill: "#282a36",
            stroke: "#ff5555",
            textColor: "#f8f8f2",
          },
          assignment: {
            fill: "#282a36",
            stroke: "#62f8e5",
            textColor: "#f8f8f2",
          },
          functionCall: {
            fill: "#282a36",
            stroke: "#ffb86c",
            textColor: "#f8f8f2",
          },
          asyncOperation: {
            fill: "#282a36",
            stroke: "#ff79c6",
            textColor: "#f8f8f2",
          },
          breakContinue: {
            fill: "#282a36",
            stroke: "#ff5555",
            textColor: "#f8f8f2",
          },
          returnNode: {
            fill: "#282a36",
            stroke: "#50fa7b",
            textColor: "#f8f8f2",
          },
        },
        light: {
          entry: { fill: "#f8f8f2", stroke: "#7c3aed", textColor: "#44475a" },
          exit: { fill: "#f8f8f2", stroke: "#7c3aed", textColor: "#44475a" },
          process: { fill: "#f8f8f2", stroke: "#0ea5e9", textColor: "#44475a" },
          decision: {
            fill: "#f8f8f2",
            stroke: "#eab308",
            textColor: "#44475a",
          },
          loop: { fill: "#f8f8f2", stroke: "#22c55e", textColor: "#44475a" },
          exception: {
            fill: "#f8f8f2",
            stroke: "#ef4444",
            textColor: "#44475a",
          },
          assignment: {
            fill: "#f8f8f2",
            stroke: "#1f9c91",
            textColor: "#44475a",
          },
          functionCall: {
            fill: "#f8f8f2",
            stroke: "#f97316",
            textColor: "#44475a",
          },
          asyncOperation: {
            fill: "#f8f8f2",
            stroke: "#ec4899",
            textColor: "#44475a",
          },
          breakContinue: {
            fill: "#f8f8f2",
            stroke: "#ef4444",
            textColor: "#44475a",
          },
          returnNode: {
            fill: "#f8f8f2",
            stroke: "#22c55e",
            textColor: "#44475a",
          },
        },
      },
    ],
    [
      "material-theme",
      {
        name: "Material Theme",
        dark: {
          entry: { fill: "#263238", stroke: "#c792ea", textColor: "#eeffff" },
          exit: { fill: "#263238", stroke: "#c792ea", textColor: "#eeffff" },
          process: { fill: "#263238", stroke: "#82b1ff", textColor: "#eeffff" },
          decision: {
            fill: "#263238",
            stroke: "#ffcb6b",
            textColor: "#eeffff",
          },
          loop: { fill: "#263238", stroke: "#89ddff", textColor: "#eeffff" },
          exception: {
            fill: "#263238",
            stroke: "#f07178",
            textColor: "#eeffff",
          },
          assignment: {
            fill: "#263238",
            stroke: "#ffd700",
            textColor: "#eeffff",
          },
          functionCall: {
            fill: "#263238",
            stroke: "#ffab40",
            textColor: "#eeffff",
          },
          asyncOperation: {
            fill: "#263238",
            stroke: "#c792ea",
            textColor: "#eeffff",
          },
          breakContinue: {
            fill: "#263238",
            stroke: "#ff5370",
            textColor: "#eeffff",
          },
          returnNode: {
            fill: "#263238",
            stroke: "#c3e88d",
            textColor: "#eeffff",
          },
        },
        light: {
          entry: { fill: "#fafafa", stroke: "#7c4dff", textColor: "#90a4ae" },
          exit: { fill: "#fafafa", stroke: "#7c4dff", textColor: "#90a4ae" },
          process: { fill: "#fafafa", stroke: "#2196f3", textColor: "#90a4ae" },
          decision: {
            fill: "#fafafa",
            stroke: "#ff6f00",
            textColor: "#90a4ae",
          },
          loop: { fill: "#fafafa", stroke: "#00bcd4", textColor: "#90a4ae" },
          exception: {
            fill: "#fafafa",
            stroke: "#e53935",
            textColor: "#90a4ae",
          },
          assignment: {
            fill: "#fafafa",
            stroke: "#ffc107",
            textColor: "#90a4ae",
          },
          functionCall: {
            fill: "#fafafa",
            stroke: "#ff9800",
            textColor: "#90a4ae",
          },
          asyncOperation: {
            fill: "#fafafa",
            stroke: "#9c27b0",
            textColor: "#90a4ae",
          },
          breakContinue: {
            fill: "#fafafa",
            stroke: "#f44336",
            textColor: "#90a4ae",
          },
          returnNode: {
            fill: "#fafafa",
            stroke: "#4caf50",
            textColor: "#90a4ae",
          },
        },
      },
    ],
    [
      "nord",
      {
        name: "Nord",
        dark: {
          entry: { fill: "#2e3440", stroke: "#b48ead", textColor: "#d8dee9" },
          exit: { fill: "#2e3440", stroke: "#b48ead", textColor: "#d8dee9" },
          process: { fill: "#2e3440", stroke: "#81a1c1", textColor: "#d8dee9" },
          decision: {
            fill: "#2e3440",
            stroke: "#ebcb8b",
            textColor: "#d8dee9",
          },
          loop: { fill: "#2e3440", stroke: "#88c0d0", textColor: "#d8dee9" },
          exception: {
            fill: "#2e3440",
            stroke: "#bf616a",
            textColor: "#d8dee9",
          },
          assignment: {
            fill: "#2e3440",
            stroke: "#8fbcbb",
            textColor: "#d8dee9",
          },
          functionCall: {
            fill: "#2e3440",
            stroke: "#d08770",
            textColor: "#d8dee9",
          },
          asyncOperation: {
            fill: "#2e3440",
            stroke: "#b48ead",
            textColor: "#d8dee9",
          },
          breakContinue: {
            fill: "#2e3440",
            stroke: "#bf616a",
            textColor: "#d8dee9",
          },
          returnNode: {
            fill: "#2e3440",
            stroke: "#a3be8c",
            textColor: "#d8dee9",
          },
        },
        light: {
          entry: { fill: "#eceff4", stroke: "#5e81ac", textColor: "#2e3440" },
          exit: { fill: "#eceff4", stroke: "#5e81ac", textColor: "#2e3440" },
          process: { fill: "#eceff4", stroke: "#5e81ac", textColor: "#2e3440" },
          decision: {
            fill: "#eceff4",
            stroke: "#ebcb8b",
            textColor: "#2e3440",
          },
          loop: { fill: "#eceff4", stroke: "#88c0d0", textColor: "#2e3440" },
          exception: {
            fill: "#eceff4",
            stroke: "#bf616a",
            textColor: "#2e3440",
          },
          assignment: {
            fill: "#eceff4",
            stroke: "#8fbcbb",
            textColor: "#2e3440",
          },
          functionCall: {
            fill: "#eceff4",
            stroke: "#d08770",
            textColor: "#2e3440",
          },
          asyncOperation: {
            fill: "#eceff4",
            stroke: "#b48ead",
            textColor: "#2e3440",
          },
          breakContinue: {
            fill: "#eceff4",
            stroke: "#bf616a",
            textColor: "#2e3440",
          },
          returnNode: {
            fill: "#eceff4",
            stroke: "#a3be8c",
            textColor: "#2e3440",
          },
        },
      },
    ],
    [
      "tokyo-night",
      {
        name: "Tokyo Night",
        dark: {
          entry: { fill: "#1a1b26", stroke: "#bb9af7", textColor: "#a9b1d6" },
          exit: { fill: "#1a1b26", stroke: "#bb9af7", textColor: "#a9b1d6" },
          process: { fill: "#1a1b26", stroke: "#7aa2f7", textColor: "#a9b1d6" },
          decision: {
            fill: "#1a1b26",
            stroke: "#e0af68",
            textColor: "#a9b1d6",
          },
          loop: { fill: "#1a1b26", stroke: "#7dcfff", textColor: "#a9b1d6" },
          exception: {
            fill: "#1a1b26",
            stroke: "#f7768e",
            textColor: "#a9b1d6",
          },
          assignment: {
            fill: "#1a1b26",
            stroke: "#c0caf5",
            textColor: "#a9b1d6",
          },
          functionCall: {
            fill: "#1a1b26",
            stroke: "#ff9e64",
            textColor: "#a9b1d6",
          },
          asyncOperation: {
            fill: "#1a1b26",
            stroke: "#bb9af7",
            textColor: "#a9b1d6",
          },
          breakContinue: {
            fill: "#1a1b26",
            stroke: "#f7768e",
            textColor: "#a9b1d6",
          },
          returnNode: {
            fill: "#1a1b26",
            stroke: "#9ece6a",
            textColor: "#a9b1d6",
          },
        },
        light: {
          entry: { fill: "#d5d6db", stroke: "#5a4a78", textColor: "#343b58" },
          exit: { fill: "#d5d6db", stroke: "#5a4a78", textColor: "#343b58" },
          process: { fill: "#d5d6db", stroke: "#34548a", textColor: "#343b58" },
          decision: {
            fill: "#d5d6db",
            stroke: "#8f5e15",
            textColor: "#343b58",
          },
          loop: { fill: "#d5d6db", stroke: "#0f4b6e", textColor: "#343b58" },
          exception: {
            fill: "#d5d6db",
            stroke: "#8c4351",
            textColor: "#343b58",
          },
          assignment: {
            fill: "#d5d6db",
            stroke: "#7a88b8",
            textColor: "#343b58",
          },
          functionCall: {
            fill: "#d5d6db",
            stroke: "#b15c00",
            textColor: "#343b58",
          },
          asyncOperation: {
            fill: "#d5d6db",
            stroke: "#5a4a78",
            textColor: "#343b58",
          },
          breakContinue: {
            fill: "#d5d6db",
            stroke: "#8c4351",
            textColor: "#343b58",
          },
          returnNode: {
            fill: "#d5d6db",
            stroke: "#485e30",
            textColor: "#343b58",
          },
        },
      },
    ],
  ]);

  /**
   * Retrieves theme styles based on a theme key and the VS Code theme mode.
   * @param themeKey The identifier for the theme (e.g., 'catppuccin').
   * @param vsCodeTheme The current editor theme mode ('light' or 'dark').
   * @returns The appropriate ThemeStyles object for the selected theme and mode.
   */
  public static getThemeStyles(
    themeKey: string,
    vsCodeTheme: "light" | "dark"
  ): ThemeStyles {
    // Fallback to 'monokai' if the provided key is invalid
    const selectedTheme =
      this.themeRegistry.get(themeKey) || this.themeRegistry.get("monokai")!;

    return vsCodeTheme === "dark" ? selectedTheme.dark : selectedTheme.light;
  }

  /**
   * Returns a list of available themes to populate a settings dropdown.
   * @returns An array of objects with theme keys and their user-friendly names.
   */
  public static getAvailableThemes(): { key: string; name: string }[] {
    return Array.from(this.themeRegistry.entries()).map(([key, theme]) => ({
      key,
      name: theme.name,
    }));
  }

  public static getNodeStyle(nodeType: NodeType): NodeStyle {
    return (
      this.nodeStyleRegistry.get(nodeType) ||
      this.nodeStyleRegistry.get(NodeType.PROCESS)!
    );
  }

  public static getNodeClassName(nodeType: NodeType): string {
    return `node-${nodeType.replace(/_/g, "-").toLowerCase()}`;
  }

  public static getDashArrayForBorderStyle(
    borderStyle: "solid" | "dashed" | "dotted" | "double"
  ): string {
    switch (borderStyle) {
      case "dashed":
        return "5 5";
      case "dotted":
        return "2 4";
      case "double":
        return "10 5";
      default:
        return ""; // Solid
    }
  }
}
