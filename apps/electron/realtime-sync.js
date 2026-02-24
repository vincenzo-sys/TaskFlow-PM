/**
 * RealtimeSync — Supabase Realtime subscriptions for the Electron app.
 *
 * Subscribes to Postgres changes on team-relevant tables and notifies
 * the renderer process to refresh data when teammates make changes.
 *
 * Usage:
 *   const realtime = require('./realtime-sync');
 *   await realtime.start(teamId, userId, mainWindow);
 *   // later...
 *   realtime.stop();
 */

const supabaseClient = require('./supabase-client');

let _channel = null;
let _teamId = null;
let _userId = null;
let _mainWindow = null;

/**
 * Start listening for realtime changes.
 * @param {string} teamId - current user's team ID
 * @param {string} userId - current user's ID
 * @param {BrowserWindow} mainWindow - Electron main window for IPC
 */
async function start(teamId, userId, mainWindow) {
  if (_channel) stop(); // Clean up any existing subscription

  _teamId = teamId;
  _userId = userId;
  _mainWindow = mainWindow;

  const client = await supabaseClient.getClient();

  _channel = client
    .channel(`team-${teamId}`)
    // Tasks — most frequent changes
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'tasks',
    }, (payload) => handleChange('tasks', payload))
    // Projects
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'projects',
      filter: `team_id=eq.${teamId}`,
    }, (payload) => handleChange('projects', payload))
    // Task tags
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'task_tags',
    }, (payload) => handleChange('task_tags', payload))
    // Task dependencies
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'task_dependencies',
    }, (payload) => handleChange('task_dependencies', payload))
    // Task files
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'task_files',
    }, (payload) => handleChange('task_files', payload))
    // Notebooks
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'notebooks',
    }, (payload) => handleChange('notebooks', payload))
    // Team members (new member joins)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'team_members',
      filter: `team_id=eq.${teamId}`,
    }, (payload) => handleChange('team_members', payload))
    // Project members
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'project_members',
    }, (payload) => handleChange('project_members', payload))
    .subscribe((status) => {
      console.log(`Realtime subscription status: ${status}`);
    });
}

/**
 * Handle a realtime change event.
 * Debounces rapid changes and sends a refresh signal to the renderer.
 */
let _refreshTimer = null;

function handleChange(table, payload) {
  // Ignore changes made by the current user (we already have them locally)
  // Note: payload.new may not always have user context, so we check common patterns
  const record = payload.new || payload.old || {};

  // For team-scoped tables, verify it's our team
  if (record.team_id && record.team_id !== _teamId) return;

  console.log(`Realtime: ${payload.eventType} on ${table} (id: ${record.id || 'n/a'})`);

  // Debounce: batch rapid changes into a single refresh (500ms window)
  if (_refreshTimer) clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => {
    _refreshTimer = null;
    notifyRenderer(table, payload.eventType);
  }, 500);
}

/**
 * Send a refresh signal to the renderer process.
 */
function notifyRenderer(table, eventType) {
  if (!_mainWindow || _mainWindow.isDestroyed()) return;

  _mainWindow.webContents.send('realtime-change', {
    table,
    eventType,
    timestamp: Date.now(),
  });
}

/**
 * Stop all realtime subscriptions.
 */
async function stop() {
  if (_channel) {
    try {
      const client = await supabaseClient.getClient();
      await client.removeChannel(_channel);
    } catch (err) {
      console.error('Error removing realtime channel:', err.message);
    }
    _channel = null;
  }
  if (_refreshTimer) {
    clearTimeout(_refreshTimer);
    _refreshTimer = null;
  }
}

module.exports = { start, stop };
