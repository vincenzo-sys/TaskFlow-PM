import fs from "fs";
import path from "path";
import os from "os";

const DATA_PATH = path.join(
  process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
  "taskflow-pm",
  "taskflow-data.json"
);

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function loadData() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
    }
  } catch (error) {
    console.error("Error loading data:", error);
  }
  return {
    projects: [{ id: "inbox", name: "Inbox", color: "#6366f1", tasks: [], isInbox: true }],
    tags: [
      { id: "tag-1", name: "Work", color: "#3498db" },
      { id: "tag-2", name: "Personal", color: "#2ecc71" },
      { id: "tag-3", name: "Urgent", color: "#e74c3c" },
    ],
    settings: { theme: "dark" },
  };
}

function saveData(data) {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

// Test: Create sample tasks
console.log("Testing TaskFlow MCP Server...\n");

const data = loadData();
console.log("1. Loaded/created data structure");

// Add sample project
let testProject = data.projects.find((p) => p.name === "Test Project");
if (!testProject) {
  testProject = {
    id: generateId(),
    name: "Test Project",
    description: "Created by MCP test",
    color: "#9b59b6",
    tasks: [],
    createdAt: new Date().toISOString(),
  };
  data.projects.push(testProject);
  console.log("2. Created test project");
} else {
  console.log("2. Test project already exists");
}

// Add sample task
const today = new Date().toISOString().split("T")[0];
const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

const sampleTasks = [
  { name: "Review MCP integration", priority: "high", dueDate: today, status: "todo" },
  { name: "Test Claude Desktop connection", priority: "medium", dueDate: tomorrow, status: "todo" },
  { name: "Build amazing features", priority: "urgent", dueDate: today, status: "in-progress" },
];

for (const taskData of sampleTasks) {
  const exists = testProject.tasks.some((t) => t.name === taskData.name);
  if (!exists) {
    testProject.tasks.push({
      id: generateId(),
      name: taskData.name,
      description: "",
      status: taskData.status,
      priority: taskData.priority,
      dueDate: taskData.dueDate,
      tags: [],
      subtasks: [],
      createdAt: new Date().toISOString(),
    });
  }
}
console.log("3. Added sample tasks");

saveData(data);
console.log("4. Saved data to:", DATA_PATH);

// Verify
const verify = loadData();
const totalTasks = verify.projects.reduce((sum, p) => sum + p.tasks.length, 0);
console.log("\n--- Results ---");
console.log(`Projects: ${verify.projects.length}`);
console.log(`Total Tasks: ${totalTasks}`);
console.log(`Tags: ${verify.tags.length}`);
console.log("\nMCP Server test complete! Data is ready.");
console.log("\nNext steps:");
console.log("1. Restart Claude Desktop");
console.log("2. Ask Claude: 'What are my tasks?' or 'Plan my day'");
