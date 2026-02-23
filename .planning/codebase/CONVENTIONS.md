# TaskFlow PM - Code Conventions

**Last Updated:** 2026-02-23

## JavaScript Conventions

### Class Architecture
- Single monolithic `TaskFlowApp` class in `renderer.js`
- ~150+ methods, all in one class
- Lifecycle: `constructor()` → `init()` → `bindEvents()` → `render()`

### Method Naming Patterns

**Render methods** (`render*`): Generate and inject HTML into the DOM
```javascript
renderTodayView()           // Full view render
renderActiveTasks()         // Component render
renderUpNextQueue(tasks)    // Subcomponent with data param
renderDualTrackTimeline()   // Legacy (dead code, still exists)
```

**CRUD methods**: Standard create/update/delete/find
```javascript
createTask(taskData)        // Returns new task object
updateTask(taskId, updates) // Merges updates, sets updatedAt
deleteTask(taskId)          // Removes from project
findTask(taskId)            // Searches all projects + subtasks recursively
```

**State mutation** (`add*`, `remove*`, `set*`, `toggle*`):
```javascript
addActiveTask(id)           // Add to workingOnTaskIds array
removeActiveTask(id)        // Remove from workingOnTaskIds
setWorkingOnTask(id)        // Legacy compat (adds to array or clears)
toggleFavorite(projectId)   // Toggle project favorite
```

**Query methods** (`get*`, `is*`):
```javascript
getFilteredTasks(filters)   // Returns filtered task array
isTaskBlocked(taskId)       // Returns boolean
getBlockingTasks(taskId)    // Returns array of blocking task IDs
getAllTasks()                // Returns flat array of all tasks
```

**Event/UI methods** (`open*`, `close*`, `show*`, `bind*`):
```javascript
bindEvents()                // All event listeners (called once in init)
openModal(content)          // Show modal overlay
closeModal()                // Hide modal
showToast(message, duration)// Temporary notification
showContextMenu(items, x, y)// Right-click menu
```

**Utility methods**:
```javascript
escapeHtml(str)             // XSS protection for user content
generateId()                // Random ID string
formatDate(dateStr)         // Date formatting
saveData()                  // Persist via IPC
```

### Event Binding Pattern
All event listeners are set up in `bindEvents()`, called once during `init()`:
```javascript
bindEvents() {
    document.getElementById('btn').addEventListener('click', () => {
        this.someAction();
    });
    // ... hundreds of listeners
}
```

Dynamic content uses event delegation on parent containers or re-binds after render.

### Data Persistence Pattern
```javascript
// Every mutation follows this pattern:
this.updateTask(taskId, { status: 'done' });
this.saveData();    // IPC call to main.js
this.render();      // Re-render current view
```

`saveData()` calls `window.api.saveData(this.data)` which goes through the preload bridge to `main.js`, which writes the JSON file.

### HTML Generation
All views are built via template literals with innerHTML assignment:
```javascript
container.innerHTML = `
    <div class="task-card" data-task-id="${task.id}">
        <span>${this.escapeHtml(task.name)}</span>
    </div>
`;
```

**Convention:** Always use `this.escapeHtml()` for user-provided content (names, descriptions).

### Error Handling
- `try-catch` used primarily around async file I/O operations
- User-facing errors shown via `showToast(message)`
- Developer errors logged via `console.error()`
- **Note:** Many areas lack error handling (see CONCERNS.md)

## CSS Conventions

### Design System (Custom Properties)
62+ CSS custom properties defined in `:root`:
```css
/* Colors */
--primary: #6366f1;          /* Indigo — AI tasks */
--primary-light: #818cf8;
--secondary: #10b981;        /* Emerald — manual tasks */
--bg-primary: #0f172a;       /* Dark background */
--text-primary: #f1f5f9;

/* Spacing scale */
--space-xs: 4px;
--space-sm: 8px;
--space-md: 16px;
--space-lg: 24px;
--space-xl: 32px;

/* Shadows */
--shadow-sm: 0 1px 2px ...;
--shadow-md: 0 4px 6px ...;
--shadow-lg: 0 10px 15px ...;

/* Transitions */
--transition: all 200ms ease;
--transition-fast: all 120ms ease;
--transition-slow: all 300ms ease;

/* Border radius */
--radius-sm: 6px;
--radius-md: 8px;
--radius-lg: 12px;
```

### Class Naming
BEM-like but simplified:
```css
.task-card { }              /* Component */
.task-card-header { }       /* Component-element */
.task-card.urgent { }       /* Component.modifier */
.task-card:hover { }        /* State via pseudo-class */
```

### Layout Patterns
- **Flexbox** used extensively for layouts
- **CSS Grid** used for specific views (calendar, timeline)
- **No float-based layouts**

### Color Coding Convention
| Color | Hex | Meaning |
|-------|-----|---------|
| Indigo | #6366f1 | AI/Claude tasks |
| Emerald | #10b981 | Manual/human tasks |
| Amber | #f59e0b | Hybrid tasks |
| Red | #ef4444 | Urgent priority |
| Gray | #64748b | Muted/secondary |

## MCP Server Conventions

### Tool Definition Pattern
```javascript
// In listTools():
{
    name: "tool_name",
    description: "What the tool does",
    inputSchema: {
        type: "object",
        properties: { ... },
        required: [...]
    }
}
```

### Tool Handler Pattern
```javascript
// In callTool():
case "tool_name": {
    const data = loadData();
    // ... process request
    saveData(data);
    return {
        content: [{ type: "text", text: JSON.stringify(result) }]
    };
}
```

### Response Format
All MCP tools return `{ content: [{ type: "text", text: string }] }` where text is JSON-stringified data.

## Data Model Conventions

### ID Generation
- Random string IDs via `generateId()` or `Date.now().toString(36) + Math.random().toString(36)`
- No UUID library

### Timestamps
- ISO 8601 strings for `createdAt`, `updatedAt`, `completedAt`
- `YYYY-MM-DD` strings for dates (`dueDate`, `scheduledDate`, `startDate`, `endDate`)
- `HH:MM` strings for times (`scheduledTime`)

### Priority Ordering
```javascript
const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
```

### Migration Pattern (in main.js)
```javascript
function migrateData(data) {
    // Each migration is idempotent (safe to run multiple times)
    if (!data.settings) data.settings = {};
    if (!data.settings.teamMembers) data.settings.teamMembers = [];
    // ... add new fields with defaults
    return data;
}
```
