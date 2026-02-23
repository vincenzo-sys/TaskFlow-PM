# TaskFlow PM - Technical Concerns

**Last Updated:** 2026-02-23

## Critical Issues

### 1. Monolithic renderer.js (~13,229 lines)
- **Single `TaskFlowApp` class** with 150+ methods
- All business logic, rendering, event handling, and state management in one file
- Adding/modifying one view requires loading the entire file
- Refactoring is high-risk without tests
- **Roadmap:** Week 4 plans to split into ~12 focused modules

### 2. Monolithic styles.css (~13,851 lines)
- All component styles in one file
- Dead CSS mixed with active styles (no way to know which rules are unused)
- Hard to find relevant styles for a specific component
- **Roadmap:** Week 4 plans to split into component-scoped files

### 3. XSS Vulnerability — Inconsistent HTML Escaping
- `escapeHtml()` method exists and works correctly
- **But:** Many `innerHTML` assignments use direct string interpolation without escaping
- User-provided content (task names, descriptions, notes) could inject HTML
- **Fix:** Audit all innerHTML assignments, ensure `escapeHtml()` wraps all user data

### 4. No Automated Tests (0% coverage)
- Zero test files in the project
- No test framework installed
- Core data operations (save, load, migrate) are untested
- Refactoring is dangerous without regression tests
- See `TESTING.md` for detailed analysis

## Security Concerns

### Shared Data File Without Locking
- Both `main.js` and `mcp-server/index.js` read/write `taskflow-data.json`
- No file locking or conflict resolution
- If Claude (via MCP) and the app write simultaneously, data loss is possible
- **Mitigation:** Low probability since MCP operations are user-initiated and fast

### Hardcoded Paths
- Claude Queue path hardcoded: `C:\Users\vince\OneDrive\Vincenzo\Claude\Claude Queue\run_queue.bat`
- Should be configurable via settings
- **Roadmap:** Week 2 plans to make configurable

### Process Spawning
- `child_process.exec()` used to launch Claude CLI and batch files
- Arguments should be validated/sanitized before passing to shell
- Current usage appears safe (no user input in command strings)

## Error Handling Gaps

### Renderer (renderer.js)
- Only ~4-5 try-catch blocks in 13,229 lines
- No error handling in event listeners (hundreds of them)
- No guards in render methods — one error crashes the entire view
- `saveData()` return value not checked — silent data loss possible

### Main Process (main.js)
- `saveData()` errors logged but not reported to user
- `loadData()` has basic fallback to defaults on parse error
- Migration errors not caught individually

### MCP Server (mcp-server/index.js)
- Weak input validation — no date format checks, no length limits
- No bounds checking on numeric inputs
- Tool handlers assume data integrity

**Roadmap:** Week 4 plans to add error handling (try-catch wrappers, user-facing error toasts)

## Dead Code

### Legacy Command Center
- `renderCommandCenter()` exists but redirects to `renderTodayView()`
- `renderDualTrackTimeline()` — old timeline renderer, no longer called
- `renderFocusQueue()` — old focus queue, replaced by Today view
- These methods are guarded by DOM element checks so they're safe, but add ~500+ lines of dead code

### Unused State
- `undoStack` declared in constructor but never populated or used
- Old `workingOnTaskId` (string) migrated to `workingOnTaskIds` (array), but `setWorkingOnTask()` still exists as legacy compat

## Performance Concerns

### Repeated Full Scans
- `getAllTasks()` iterates all projects every time it's called
- No caching — called repeatedly during renders and queries
- With 20-50 tasks/day this is fine, but could become slow at scale

### Full Re-renders
- Most state changes trigger full `render()` of the current view
- No virtual DOM or diff — entire innerHTML is replaced
- With current data sizes this is imperceptible, but wasteful

### Large File Writes
- Entire `taskflow-data.json` rewritten on every save
- No incremental updates or journaling
- Fine for current data sizes, potential issue with years of accumulated data

## Fragile Areas

### Timeline View (renderer.js)
- SVG dependency arrows with complex coordinate math
- Bar drag/resize with mouse event handlers
- Document-level listeners stored in `_tlCleanup` for manual cleanup
- Scroll sync between left panel and chart — easy to desync

### Focus Mode (renderer.js)
- Pomodoro timer with setInterval — no cleanup on view switch
- Multiple floating windows (pill, bar) need state sync with main window
- IPC messages can arrive out of order

### Data Migrations (main.js)
- Each migration modifies data in place
- No versioning — just checks if fields exist
- A broken migration could corrupt user data with no rollback

## Summary of Priorities

| Issue | Severity | Effort | When |
|-------|----------|--------|------|
| XSS (innerHTML) | High | Medium | ASAP |
| No tests | High | High | Week 4 (with refactor) |
| Error handling | Medium | Medium | Week 4 |
| Monolithic files | Medium | High | Week 4 |
| Dead code cleanup | Low | Low | Week 4 |
| Data file locking | Low | Medium | Week 2 |
| Hardcoded paths | Low | Low | Week 2 |
