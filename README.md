# Visor: Multi-Language Code-to-Flowchart Visualization

**Visor** is a powerful VS Code extension that generates **real-time, interactive flowcharts** for your code. It helps you understand, debug, and document complex logic by transforming it into a clear visual representation.

---

### Features ✨

- **Real-Time Flowchart Generation**: Flowcharts automatically update as you navigate or edit your code. Place your cursor inside a function, and Visor instantly visualizes its logic.
- **Bidirectional Navigation**: Click on a node in the flowchart to jump to the corresponding code, and watch the flowchart highlight as you move your cursor through the code.
- **Multi-Language Support**: Works out of the box with **Python, TypeScript/JavaScript, Java, C++, C, and Rust**. It supports a wide range of code constructs including functions, classes, loops, conditionals, and exceptions.
- **Cyclomatic Complexity Analysis**: Get instant feedback on your code's complexity with real-time metrics and visual indicators (⚠️, 🔴, 🚨) on complex nodes.
- **Enhanced Readability**: Flowcharts use **semantic nodes** to visually distinguish between different code elements—like decisions (diamond shape), loops (stadium shape), and processes (rectangle). The design is theme-aware and professionally styled.
- **Flexible Viewing**: View flowcharts in the VS Code sidebar or in a dedicated external window, perfect for multi-monitor setups.
- **Export Capabilities**: Easily export your flowcharts as high-quality **SVG** (vector) or **PNG** (raster) images for documentation.

---

### Quick Start 🚀

1.  **Install** the Visor extension from the VS Code Marketplace.
2.  **Open** a supported code file (Python, C++, etc.).
3.  **Click** the Visor icon in the Activity Bar to open the panel.
4.  **Place your cursor** inside a function to see the flowchart instantly appear.

---

### Configuration ⚙️

You can customize Visor's behavior through the VS Code settings (`Cmd/Ctrl + ,`). Search for "Visor" to adjust settings for:

- **Complexity Thresholds**: Set your own ratings for low, medium, and high complexity.
- **Visuals**: Customize how complexity indicators are displayed.

<!-- end list -->

```json
{
  "visor.complexity.enabled": true,
  "visor.complexity.thresholds.low": 5,
  "visor.complexity.thresholds.medium": 10,
  "visor.complexity.thresholds.high": 20
}
```

---

### Technical Details & Privacy

Visor is built on **Tree-sitter** for robust code parsing and **Mermaid.js** for high-quality diagram rendering. All code analysis and flowchart generation are performed locally on your machine, ensuring your code remains **completely private and secure**.

**Editor Compatibility**: Visor works seamlessly with VS Code, Cursor, and Windsurf editors. The extension automatically detects your environment and applies compatibility optimizations when needed.

---

### Support & Contributions ❤️

We appreciate your support\! If you find a bug or have a feature idea, please open an issue or a pull request on our GitHub repository. This project is licensed under the **MIT License**.

- [GitHub Repository](https://github.com/sidhant-sriv/visor.git)
- [Buy Me a Coffee](https://buymeacoffee.com/sidsodsud)

## Contributors

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/sidhant-sriv">
        <img src="https://avatars.githubusercontent.com/sidhant-sriv" width="100px;" alt="Sidhant Srivastava"/>
        <br />
        <sub><b>Sidhant Srivastava</b></sub>
      </a>
      <br />
      <a href="https://www.linkedin.com/in/sidhant-srivastava-41803620b/" title="LinkedIn">🔗</a>
      <a href="https://x.com/sidsodsudx" title="X">🐦</a>
      <a href="https://github.com/sidhant-sriv" title="GitHub">🐙</a>
    </td>
    <td align="center">
      <a href="https://github.com/fakubwoy">
        <img src="https://avatars.githubusercontent.com/fakubwoy" width="100px;" alt="Fakubwoy"/>
        <br />
        <sub><b>Fakubwoy</b></sub>
      </a>
      <br />
      <a href="https://www.linkedin.com/in/farhaan-khan-1629202b8/" title="LinkedIn">🔗</a>
      <a href="https://github.com/fakubwoy" title="GitHub">🐙</a>
    </td>
  </tr>
</table>
