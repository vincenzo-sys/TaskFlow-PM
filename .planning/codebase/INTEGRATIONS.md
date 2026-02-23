# TaskFlow PM - Integrations

**Last Updated:** 2026-02-23

## Overview

TaskFlow PM is a **fully local-first application** with no external API calls, no cloud services, and no network dependencies. It works completely offline.

The only external integration is with **Claude** (Anthropic's AI) via the Model Context Protocol (MCP), which is initiated by the user — not the app.

## MCP Server Integration (Claude)

### Server Location
- `mcp-server/index.js` (~5,802 lines)
- Framework: `@modelcontextprotocol/sdk` v1.4.1
- Transport: stdio (launched as subprocess by Claude Desktop/Claude Code)

### MCP Tools (40+)

**Core CRUD:**
- `get_all_tasks`, `create_task`, `update_task`, `delete_task`, `complete_task`

**View Queries:**
- `get_today_tasks`, `get_overdue_tasks`, `get_upcoming_tasks`, `get_inbox_tasks`, `get_ready_tasks`

**Project Management:**
- `get_projects`, `create_project`, `delete_project`

**Scheduling:**
- `set_scheduled_time`, `clear_scheduled_time`, `bulk_schedule_today`, `get_scheduled_tasks`

**AI Processing:**
- `process_brain_dump`, `suggest_subtasks`, `suggest_priority`, `suggest_next_task`

**Parallel Execution:**
- `set_execution_type`, `suggest_parallel_tasks`, `get_parallel_schedule`

**Reviews & Planning:**
- `daily_recap`, `weekly_review`, `plan_my_day`, `get_focus_task`

**Recap Documentation:**
- `add_recap_entry`, `get_recap_log`, `save_recap`, `get_saved_recaps`, `get_recap_by_id`, `delete_recap_entry`

**Project Notebooks:**
- `get_project_notebooks`, `get_notebook`, `create_notebook`, `update_notebook`, `delete_notebook`, `append_to_notebook`

### Data Sharing
- MCP server reads/writes the same `taskflow-data.json` as the main app
- **No locking mechanism** — potential for conflicts if both access simultaneously
- MCP server uses `loadData()` / `saveData()` functions directly on the JSON file

## IPC Channels (Main ↔ Renderer)

### Data Operations
| Channel | Direction | Purpose |
|---------|-----------|---------|
| `load-data` | Renderer → Main | Load task data from JSON file |
| `save-data` | Renderer → Main | Persist task data to JSON file |
| `export-data` | Renderer → Main | Export data to user-chosen location |
| `import-data` | Renderer → Main | Import data from user-chosen file |

### File Operations
| Channel | Direction | Purpose |
|---------|-----------|---------|
| `open-path` | Renderer → Main | Open file/folder in OS |
| `browse-file` | Renderer → Main | Show file dialog |
| `write-file` | Renderer → Main | Create/write arbitrary file |

### Clipboard & External
| Channel | Direction | Purpose |
|---------|-----------|---------|
| `copy-to-clipboard` | Renderer → Main | Copy text to system clipboard |
| `open-external` | Renderer → Main | Open URL in default browser |

### Focus Pill Widget
| Channel | Direction | Purpose |
|---------|-----------|---------|
| `show-pill` / `hide-pill` | Renderer → Main | Toggle floating pill |
| `update-pill` | Renderer → Main | Update pill content |
| `pill-action` | Bidirectional | Actions from pill (complete, skip, etc.) |

### Quick Capture Window
| Channel | Direction | Purpose |
|---------|-----------|---------|
| `show-capture` | Main → Renderer | Show capture overlay |
| `task-captured` | Capture → Main | New task captured |
| `capture-save` / `capture-close` | Capture → Main | Save/close events |

### Floating Task Bar
| Channel | Direction | Purpose |
|---------|-----------|---------|
| `show-floating-bar` / `hide-floating-bar` | Renderer → Main | Toggle bar |
| `update-floating-bar` | Renderer → Main | Update bar content |
| `floating-bar-complete-task` | Bar → Main | Task completed from bar |
| `floating-bar-toggle-subtask` | Bar → Main | Subtask toggled |
| `floating-bar-remove-task` | Bar → Main | Task removed from bar |
| `floating-bar-resize` / `floating-bar-set-size` | Bar → Main | Resize events |

### Claude Integration
| Channel | Direction | Purpose |
|---------|-----------|---------|
| `launch-claude-session` | Renderer → Main | Launch Claude CLI in working dir |
| `launch-claude-with-config` | Renderer → Main | Launch Claude with project config |
| `run-claude-queue` | Renderer → Main | Execute batch Claude tasks |

### System
| Channel | Direction | Purpose |
|---------|-----------|---------|
| `trigger-shortcut` | Renderer → Main | Trigger via PowerShell |
| `shortcut-registered` | Main → Renderer | Confirm shortcut registered |

## Process Spawning

The app uses Node's `child_process.exec()` to launch external processes:

1. **Claude CLI sessions** — Opens `cmd /k claude` in project working directory
2. **Claude Queue** — Executes batch file for overnight task processing
3. **PowerShell shortcuts** — Triggers global keyboard shortcuts

### Claude Queue (Hardcoded Path)
```
C:\Users\vince\OneDrive\Vincenzo\Claude\Claude Queue\run_queue.bat
```
- Launched via `exec()` to spawn batch file in separate terminal
- **TODO:** Make this path configurable (Week 2 roadmap item)

## External Services

| Service | Status |
|---------|--------|
| HTTP APIs | None |
| Databases | None (JSON file only) |
| Authentication | None |
| WebSockets | None |
| Cloud Storage | None |
| Analytics | None |

**The app is 100% offline-capable.** All Claude integration is user-initiated via MCP tools.
