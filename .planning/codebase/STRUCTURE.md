# TaskFlow PM - Project Structure

**Last Updated:** 2026-02-23

## Directory Layout

```
To Do Software/
├── .claude/                    # Claude Code config
│   └── settings.local.json
├── .planning/                  # GSD planning docs (new)
│   └── codebase/               # Codebase analysis (this folder)
├── mcp-server/
│   ├── index.js                # MCP server (5,802 lines, 40+ tools)
│   └── package.json            # MCP dependencies (@modelcontextprotocol/sdk)
├── main.js                     # Electron main process (756 lines)
├── renderer.js                 # All UI logic - TaskFlowApp class (13,229 lines)
├── styles.css                  # All styles (13,851 lines)
├── index.html                  # Main window template (1,213 lines)
├── quick-capture.html          # Quick capture overlay (~450 lines)
├── focus-pill.html             # Floating focus widget (~256 lines)
├── floating-bar.html           # Floating task bar (~586 lines)
├── preload.js                  # Main window IPC bridge (50+ APIs)
├── preload-capture.js          # Quick capture IPC bridge
├── preload-pill.js             # Focus pill IPC bridge
├── preload-floating-bar.js     # Floating bar IPC bridge
├── package.json                # App dependencies & scripts
├── CLAUDE.md                   # Project context for Claude
├── start-taskflow.bat          # Windows launch script
└── claude-desktop-config.json  # MCP server config for Claude Desktop
```

## Files by Layer

### Main Process (Electron backend)
| File | Lines | Purpose |
|------|-------|---------|
| `main.js` | ~756 | Window management, IPC handlers, data I/O, migrations, process spawning |

### Renderer (UI)
| File | Lines | Purpose |
|------|-------|---------|
| `renderer.js` | ~13,229 | TaskFlowApp class — all views, events, rendering, state |
| `styles.css` | ~13,851 | All CSS — design system, component styles |

### HTML Templates
| File | Lines | Purpose |
|------|-------|---------|
| `index.html` | ~1,213 | Main window layout, nav, modals |
| `quick-capture.html` | ~450 | Capture overlay (Ctrl+Shift+Space) |
| `focus-pill.html` | ~256 | Floating focus mode widget |
| `floating-bar.html` | ~586 | Compact task bar |

### Preload Bridges (IPC)
| File | Lines | Purpose |
|------|-------|---------|
| `preload.js` | ~130 | Main window — 50+ API methods |
| `preload-capture.js` | ~20 | Quick capture — save/close |
| `preload-pill.js` | ~25 | Focus pill — actions |
| `preload-floating-bar.js` | ~40 | Floating bar — task actions |

### MCP Server (Claude Integration)
| File | Lines | Purpose |
|------|-------|---------|
| `mcp-server/index.js` | ~5,802 | 40+ MCP tools, data access |
| `mcp-server/package.json` | ~10 | MCP SDK dependency |

## Naming Conventions

### JavaScript
- **camelCase** for variables and functions: `createTask`, `selectedTaskId`
- **PascalCase** for the class: `TaskFlowApp`
- **Prefix `_`** for private/internal state: `_autoRollDone`, `_projectViewState`
- **Prefix `render`** for rendering methods: `renderTodayView()`, `renderCalendar()`
- **Prefix `bind`** for event setup: `bindEvents()`, `bindTimelineDropZones()`
- **Prefix `get`/`find`** for queries: `getFilteredTasks()`, `findTask()`
- **Prefix `open`/`close`** for modals: `openModal()`, `closeModal()`
- **Prefix `show`** for toasts/UI: `showToast()`, `showContextMenu()`

### CSS
- **kebab-case** for class names: `.task-card`, `.focus-queue`
- **BEM-like** structure: `.component-element`, `.component.modifier`
- **CSS custom properties** with `--` prefix: `--primary`, `--shadow-md`
- **Semantic color tokens**: `--text-primary`, `--bg-secondary`

### HTML
- **IDs** for key containers: `#app`, `#main-content`, `#sidebar`
- **Classes** for styling: `.view-container`, `.task-item`
- **data-* attributes** for state: `data-task-id`, `data-project-id`

## Key Method Categories in renderer.js

| Pattern | Count | Examples |
|---------|-------|---------|
| `render*` | ~30+ | `renderTodayView`, `renderCalendar`, `renderTaskBoard` |
| `create*` | ~5 | `createTask`, `createProject`, `createSubtask` |
| `update*` | ~5 | `updateTask`, `updateProject` |
| `delete*` | ~5 | `deleteTask`, `deleteProject`, `deleteSubtask` |
| `open*` | ~10 | `openModal`, `openTaskPicker`, `openLauncherModal` |
| `close*` | ~5 | `closeModal`, `closeAllModals` |
| `bind*` | ~5 | `bindEvents`, `bindTimelineDropZones` |
| `get*`/`find*` | ~15 | `getFilteredTasks`, `findTask`, `getBlockingTasks` |
| `show*` | ~5 | `showToast`, `showContextMenu` |

## Data File Location

```
Windows: %APPDATA%/taskflow-pm/taskflow-data.json
```

Accessed by both `main.js` (via Electron's `app.getPath('userData')`) and `mcp-server/index.js` (via same path resolution).
