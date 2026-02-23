# TaskFlow PM - Architecture

**Last Updated:** 2026-02-23

## Pattern

**Monolithic single-class Electron app** with IPC-mediated layers.

All UI logic lives in one `TaskFlowApp` class (~13,229 lines, ~150+ methods) in `renderer.js`. The main process (`main.js`) handles I/O, windows, and data persistence. An MCP server provides Claude AI integration as a separate process.

## Layers

```
┌─────────────────────────────────────────────────┐
│  Layer 1: Electron Main Process (main.js)       │
│  - Window management (4 windows)                │
│  - IPC handlers (25+ channels)                  │
│  - File I/O (JSON data persistence)             │
│  - Data migration on startup                    │
│  - Process spawning (Claude CLI, queue)          │
│  - Global shortcuts                              │
├─────────────────────────────────────────────────┤
│  Layer 2: Preload Bridges (4 scripts)           │
│  - preload.js (50+ exposed APIs)                │
│  - preload-capture.js                           │
│  - preload-pill.js                              │
│  - preload-floating-bar.js                      │
│  - contextBridge.exposeInMainWorld()            │
├─────────────────────────────────────────────────┤
│  Layer 3: Renderer Process (renderer.js)        │
│  - TaskFlowApp class (single monolith)          │
│  - All views: Today, Inbox, Projects, Calendar  │
│  - All event handling (bindEvents)              │
│  - All rendering (render* methods)              │
│  - State management (in-memory + persisted)      │
│  - Task CRUD, drag-and-drop, focus mode          │
├─────────────────────────────────────────────────┤
│  Layer 4: HTML Templates (4 files)              │
│  - index.html (main window)                     │
│  - quick-capture.html                           │
│  - focus-pill.html                              │
│  - floating-bar.html                            │
├─────────────────────────────────────────────────┤
│  Layer 5: CSS (styles.css)                      │
│  - Design system (62+ custom properties)         │
│  - All component styles (~13,851 lines)          │
├─────────────────────────────────────────────────┤
│  Layer 6: MCP Server (mcp-server/index.js)      │
│  - Separate Node.js process                      │
│  - 40+ Claude tools                              │
│  - Reads/writes same JSON data file              │
└─────────────────────────────────────────────────┘
```

## Data Flow

### 1. App Startup
```
main.js: createWindow()
  → loadData() from taskflow-data.json
  → migrateData() (idempotent schema upgrades)
  → BrowserWindow loads index.html
    → preload.js exposes window.api
    → renderer.js: new TaskFlowApp()
      → init() → loadData via IPC → autoRollTasks() → render()
```

### 2. Task Completion
```
User clicks complete button
  → renderer.js: updateTask(id, {status: 'done'})
    → Sets completedAt timestamp
    → saveData() via IPC → main.js writes JSON
    → showToast("Task completed")
    → render() (task hidden from active views)
```

### 3. Quick Capture
```
User presses Ctrl+Shift+Space
  → main.js: globalShortcut triggers show-capture
  → quick-capture.html window appears
  → User types thought, presses Enter
  → capture-save IPC → main.js
    → Forwards to main renderer via task-captured
    → renderer.js: createTask() with context field
    → saveData()
```

### 4. Claude Integration (MCP)
```
User asks Claude to work on tasks
  → Claude Desktop/Code calls MCP tools
  → mcp-server/index.js: callTool()
    → loadData() from JSON file
    → Process request (create, update, query, etc.)
    → saveData() back to JSON file
    → Return result to Claude
```

## State Management

### Persisted State (in `taskflow-data.json`)
```javascript
{
  projects: [...],           // Array of project objects with tasks
  tags: [...],               // Tag definitions
  workingOnTaskIds: [...],   // Currently active task IDs
  recapLog: [...],           // Recap entries
  savedRecaps: [...],        // Saved recap documents
  settings: {
    teamMembers: [...],
    // other preferences
  }
}
```

### Runtime State (in-memory only, on TaskFlowApp)
```javascript
this.currentView           // Active view name
this.currentProjectId      // Selected project ID
this.selectedTaskId        // Highlighted task ID
this.todayView             // Today view state
this.focusMode             // Focus/Pomodoro state
this.expandedUpNextIds     // Set of expanded task IDs
this._projectViewState     // Per-project view state
this._projectTimelineState // Per-project timeline state
this._selectedNotebookId   // Active notebook
this._notebookPreviewMode  // Notebook preview toggle
```

## Entry Points

| Entry | File | What Happens |
|-------|------|-------------|
| `npm start` | `main.js` | Electron launches, creates windows |
| `node mcp-server/index.js` | `mcp-server/index.js` | MCP server for Claude |
| Ctrl+Shift+Space | `quick-capture.html` | Global quick capture |
| Focus pill click | `focus-pill.html` | Floating focus widget |

## Key Design Decisions

1. **No framework** — Faster iteration, zero build step, but massive single files
2. **Single class** — All state in one place, but 13K lines and growing
3. **JSON file storage** — Simple, portable, no DB setup, but no concurrent access safety
4. **Preload bridge** — Secure IPC, but 50+ API methods to maintain
5. **MCP as separate process** — Clean Claude boundary, but shares data file without locking
6. **CSS custom properties** — Theming support, but 13K lines in one file
7. **No TypeScript** — Lower barrier, but no type safety on 35K+ lines

## Known Architectural Limitations

1. **renderer.js monolith** — 13K lines, impossible to work on one view without loading all
2. **styles.css monolith** — 13K lines, dead CSS mixed with active
3. **No module system** — Can't import/export between files
4. **No error boundaries** — One crash in render can break entire UI
5. **Shared data file** — MCP server and main app can race on writes
