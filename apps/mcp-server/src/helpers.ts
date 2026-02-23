export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function todayDate(): string {
  return new Date().toISOString().split('T')[0];
}

export function getAllTasks(data: any): any[] {
  const tasks: any[] = [];
  for (const project of data.projects) {
    for (const task of project.tasks) {
      tasks.push({ ...task, projectId: project.id, projectName: project.name });
    }
  }
  return tasks;
}

export function findTask(data: any, taskId: string): { task: any; project: any; parentTask?: any } | null {
  for (const project of data.projects) {
    const task = project.tasks.find((t: any) => t.id === taskId);
    if (task) return { task, project };
    for (const t of project.tasks) {
      const subtask = t.subtasks?.find((st: any) => st.id === taskId);
      if (subtask) return { task: subtask, parentTask: t, project };
    }
  }
  return null;
}

export function formatTaskForDisplay(task: any, project: any, tags: any[]): string {
  const tagNames = task.tags
    ?.map((tagId: string) => {
      const tag = tags.find((t: any) => t.id === tagId);
      return tag ? `#${tag.name}` : null;
    })
    .filter(Boolean)
    .join(' ');

  let display = `- [${task.status === 'done' ? 'x' : ' '}] ${task.name}`;
  if (task.priority && task.priority !== 'none') display += ` !${task.priority}`;
  if (task.dueDate) display += ` (due: ${task.dueDate})`;
  if (tagNames) display += ` ${tagNames}`;
  if (project && !project.isInbox) display += ` [${project.name}]`;
  return display;
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}
