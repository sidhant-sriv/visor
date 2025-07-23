//@ts-check
"use strict";

const path = require("path");

/** @type {import('webpack').Configuration} */
const extensionConfig = {
  target: "node",
  mode: "none",

  entry: "./src/extension.ts",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "extension.js",
    libraryTarget: "commonjs2",
  },
  externals: {
    vscode: "commonjs vscode",
    "tree-sitter": "commonjs tree-sitter",
    "tree-sitter-python": "commonjs tree-sitter-python",
    "tree-sitter-typescript": "commonjs tree-sitter-typescript",
    "tree-sitter-javascript": "commonjs tree-sitter-javascript",
    "tree-sitter-java": "commonjs tree-sitter-java",
    "tree-sitter-cpp": "commonjs tree-sitter-cpp",
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{ loader: "ts-loader" }],
      },
      {
        test: /\.node$/,
        use: "node-loader",
      },
    ],
  },
  devtool: "nosources-source-map",
  infrastructureLogging: {
    level: "log",
  },
};

module.exports = [extensionConfig];
