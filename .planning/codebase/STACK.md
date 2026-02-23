# TaskFlow PM - Technology Stack

**Last Updated:** 2026-02-23

## Languages & Runtimes

| Technology | Version | Usage |
|-----------|---------|-------|
| JavaScript | ES6+ | All application code (vanilla, no framework) |
| HTML5 | - | 4 window templates |
| CSS3 | - | Custom properties, flexbox layouts |
| Node.js | Bundled with Electron | Main process, MCP server |
| Electron | 28.x | Desktop framework |

## Architecture Summary

- **Frontend:** Vanilla HTML/CSS/JavaScript (no React, Vue, etc.)
- **Backend:** Electron main process (Node.js)
- **Data Storage:** Local JSON file (`taskflow-data.json` in `%APPDATA%/taskflow-pm/`)
- **AI Integration:** MCP server (Model Context Protocol) for Claude Desktop/Claude Code
- **Build:** electron-builder for distribution

## Dependencies

### Production Dependencies

**None.** The app has zero production npm dependencies. All functionality is built with:
- Electron's built-in APIs (BrowserWindow, ipcMain, dialog, shell, clipboard)
- Node.js built-in modules (fs, path, child_process, os)
- Vanilla DOM APIs in renderer

### Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| electron | ^28.0.0 | Desktop runtime |
| electron-builder | ^24.9.1 | Build/package for distribution |

### MCP Server Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| @modelcontextprotocol/sdk | ^1.4.1 | MCP protocol implementation |

## Frontend Stack

### HTML Templates (4 files)
- `index.html` (~1,213 lines) — Main application window
- `quick-capture.html` (~450 lines) — Global quick capture overlay
- `focus-pill.html` (~256 lines) — Floating focus mode widget
- `floating-bar.html` (~586 lines) — Floating task bar

### CSS
- `styles.css` (~13,851 lines) — Single file, CSS custom properties design system
- 62+ CSS custom properties in `:root` for theming
- BEM-like naming: `.component-element`, `.component.modifier`
- Color scheme: Indigo (#6366f1) for AI, Emerald (#10b981) for manual

### JavaScript
- `renderer.js` (~13,229 lines) — Monolithic `TaskFlowApp` class, all UI logic
- No module bundler (no webpack, vite, rollup)
- No transpiler (no Babel, TypeScript)
- No framework (no React, Vue, Svelte)

## Electron Configuration

### Window Types
1. **Main Window** — Primary app (1200x800, resizable)
2. **Quick Capture** — Overlay window (Ctrl+Shift+Space)
3. **Focus Pill** — Always-on-top floating widget
4. **Floating Bar** — Compact task bar

### Security Settings
- `contextIsolation: true` — Renderer has no Node.js access
- `nodeIntegration: false` — Scripts run in sandboxed browser context
- CSP meta tag in HTML restricting script sources
- Preload scripts mediate all IPC communication

### Preload Scripts (4 files)
- `preload.js` (~51 exposed APIs) — Main window bridge
- `preload-capture.js` — Quick capture bridge
- `preload-pill.js` — Focus pill bridge
- `preload-floating-bar.js` — Floating bar bridge

## Build Configuration

- **Builder:** electron-builder 24.9.1
- **Scripts:**
  - `npm start` — Launch in development
  - `npm run build` — Package for distribution
- **No CI/CD pipeline configured**
- **No linting** (no ESLint, Prettier)
- **No testing** (no Jest, Mocha)

## Data Layer

- **Format:** JSON (single `taskflow-data.json` file)
- **Location:** `%APPDATA%/taskflow-pm/taskflow-data.json` (Windows)
- **Access:** Both main process and MCP server read/write the same file
- **Migrations:** `migrateData()` in `main.js` runs on startup (idempotent)
- **No database** (SQLite, IndexedDB, etc.)
- **No locking mechanism** between main process and MCP server

## Key File Sizes

| File | Lines | Role |
|------|-------|------|
| `renderer.js` | ~13,229 | All UI logic (single class) |
| `styles.css` | ~13,851 | All styles (single file) |
| `mcp-server/index.js` | ~5,802 | Claude integration (40+ tools) |
| `main.js` | ~756 | Electron main process |
| `index.html` | ~1,213 | Main window template |
| **Total** | **~35,000+** | |
