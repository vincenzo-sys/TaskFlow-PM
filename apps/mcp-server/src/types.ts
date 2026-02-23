export type ToolResult = { content: Array<{ type: 'text'; text: string }> };

export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(msg: string): ToolResult {
  return { content: [{ type: 'text', text: `Error: ${msg}` }] };
}
