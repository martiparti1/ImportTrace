# ImportTrace

See your code as connected windows. Each file is a scrollable window; each `import` / `#include` / `using` is an arrow that starts on the exact line that causes it.

## Features

- **Visual Code Navigation:** Instantly see how your files connect through imports.
- **Line-Precise Arrows:** Arrows start from the exact line of the import statement.
- **Scrollable Windows:** Read your code directly within the map nodes.
- **Multi-Language Support:** Works out of the box with:
  - TypeScript / JavaScript
  - Python
  - C / C++
  - Java
  - Go
  - C#

## Usage

1. Open any supported code file in VS Code.
2. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on Mac).
3. Run **`ImportTrace: Show Map for Active File`** to trace the imports starting from your current file.
4. Alternatively, use **`ImportTrace: Show Whole Workspace`** to visualize the entire project.
5. If you've added new files or changed many imports, use **`ImportTrace: Rescan Workspace`** to update the map.

## Extension Settings

You can customize ImportTrace through VS Code settings:

* `importtrace.depth`: How many import hops from the active file to show (default: `2`, max: `6`).
* `importtrace.targetColor`: The color used to highlight the currently focused target file.
* `importtrace.exclude`: Globs excluded from scanning (e.g., `node_modules`, `.git`, `dist`).
* `importtrace.maxFileSizeKB`: Files larger than this are skipped to keep performance smooth.
* `importtrace.includeTestFiles`: (Go only) link to `_test.go` files when an import resolves to a package.

## Known Limitations

- Syntax highlighting is applied per line, so multi-line strings or block comments might lose formatting.
- C#: Types in the *same* namespace that don't need a `using` statement will not show links.
- Only the nearest `tsconfig.json` is consulted per file for TypeScript (ignores `extends` and project references).
- Imports that resolve to more than 40 files are dropped to prevent massive UI clutter.

## Support

**Enjoying ImportTrace?** 
[☕ Buy me a coffee](https://buymeacoffee.com/martin.p)
