/**
 * DataService — orchestrates all Supabase CRUD for the Electron app.
 *
 * Responsibilities:
 * - Fetch all data from Supabase and transform to local format
 * - Provide granular CRUD methods (ds:* IPC channels)
 * - Sync local changes back to Supabase
 * - Maintain local JSON backup
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const supabaseClient = require('./supabase-client');
const transform = require('./data-transform');

const dataPath = path.join(app.getPath('userData'), 'taskflow-data.json');

// In-memory cache of what was last loaded from Supabase
let _cachedData = null;
let _teamId = null;
let _userId = null;
let _teamMembers = null; // cached team members

/**
 * Initialize the data service with the current user's context.
 */
async function init() {
  const client = await supabaseClient.getClient();
  const user = await supabaseClient.getUser();
  if (!user) throw new Error('Not authenticated');

  _userId = user.id;

  // Get user's team
  const { data: membership } = await client
    .from('team_members')
    .select('team_id')
    .eq('user_id', _userId)
    .limit(1)
    .single();

  if (!membership) throw new Error('No team found for user');
  _teamId = membership.team_id;

  return { userId: _userId, teamId: _teamId };
}

/**
 * Load all data from Supabase and return in renderer.js format.
 * Also saves as local JSON backup.
 */
async function loadAllData() {
  const client = await supabaseClient.getClient();

  if (!_teamId) await init();

  // Step 1: Fetch projects to get project IDs for subqueries
  const projectsRes = await client.from('projects').select('*').eq('team_id', _teamId);
  const projectIds = (projectsRes.data || []).map(p => p.id);

  // Step 2: Fetch everything else in parallel
  const [
    tasksRes,
    categoriesRes,
    tagsRes,
    taskTagsRes,
    taskFilesRes,
    taskDepsRes,
    notebooksRes,
    launchersRes,
    recapEntriesRes,
    recapEntryTagsRes,
    savedRecapsRes,
    preferencesRes,
  ] = await Promise.all([
    projectIds.length > 0
      ? client.from('tasks').select('*').in('project_id', projectIds).order('sort_order').order('created_at')
      : Promise.resolve({ data: [] }),
    client.from('categories').select('*').eq('team_id', _teamId).order('sort_order'),
    client.from('tags').select('*').eq('team_id', _teamId).order('name'),
    fetchTaskJunction(client, 'task_tags', 'task_id, tag_id', projectIds),
    fetchTaskJunction(client, 'task_files', 'task_id, file_path', projectIds),
    fetchTaskJunction(client, 'task_dependencies', 'blocked_task_id, blocking_task_id', projectIds),
    projectIds.length > 0
      ? client.from('notebooks').select('*').in('project_id', projectIds)
      : Promise.resolve({ data: [] }),
    projectIds.length > 0
      ? client.from('launchers').select('*').in('project_id', projectIds)
      : Promise.resolve({ data: [] }),
    client.from('recap_entries').select('*').eq('team_id', _teamId).order('date', { ascending: false }),
    client.from('recap_entry_tags').select('*'),
    client.from('saved_recaps').select('*').eq('team_id', _teamId).order('saved_at', { ascending: false }),
    client.from('user_preferences').select('*').eq('user_id', _userId).eq('team_id', _teamId).maybeSingle(),
  ]);

  // Attach tags to recap entries
  const recapTagMap = new Map();
  for (const rt of (recapEntryTagsRes.data || [])) {
    if (!recapTagMap.has(rt.recap_entry_id)) recapTagMap.set(rt.recap_entry_id, []);
    recapTagMap.get(rt.recap_entry_id).push(rt.tag);
  }
  const recapEntriesWithTags = (recapEntriesRes.data || []).map(entry => ({
    ...entry,
    tags: recapTagMap.get(entry.id) || [],
  }));

  const supaData = {
    projects: projectsRes.data || [],
    tasks: tasksRes.data || [],
    categories: categoriesRes.data || [],
    tags: tagsRes.data || [],
    taskTags: taskTagsRes.data || [],
    taskFiles: taskFilesRes.data || [],
    taskDependencies: taskDepsRes.data || [],
    notebooks: notebooksRes.data || [],
    launchers: launchersRes.data || [],
    recapEntries: recapEntriesWithTags,
    savedRecaps: savedRecapsRes.data || [],
    preferences: preferencesRes.data,
  };

  // Transform to local format
  const localData = transform.supabaseToLocal(supaData);

  // Fetch team members (parallel-safe, non-blocking)
  try {
    const teamMembers = await getTeamMembers();
    localData.teamMembers = teamMembers;
  } catch (err) {
    console.error('Failed to load team members:', err.message);
    localData.teamMembers = [];
  }

  // Include userId for renderer
  localData.currentUserId = _userId;

  // Cache for change detection
  _cachedData = localData;

  // Save local backup
  saveLocalBackup(localData);

  return localData;
}

/**
 * Fetch junction table rows for tasks belonging to this team's projects.
 */
async function fetchTaskJunction(client, table, selectColumns, projectIds) {
  if (projectIds.length === 0) return { data: [] };

  // Get task IDs for these projects
  const taskIds = (await client.from('tasks').select('id').in('project_id', projectIds)).data?.map(t => t.id) || [];
  if (taskIds.length === 0) return { data: [] };

  if (table === 'task_dependencies') {
    return client.from(table).select(selectColumns).or(`blocked_task_id.in.(${taskIds.join(',')}),blocking_task_id.in.(${taskIds.join(',')})`);
  }
  return client.from(table).select(selectColumns).in('task_id', taskIds);
}

// ── Granular CRUD Methods ───────────────────────────────────

async function createTask(taskData) {
  const client = await supabaseClient.getClient();
  const supaTask = transform.localTaskToSupabase(taskData, taskData.projectId);
  delete supaTask.id; // Let Supabase generate UUID

  const { data, error } = await client
    .from('tasks')
    .insert(supaTask)
    .select()
    .single();
  if (error) throw error;

  // Handle subtasks
  if (taskData.subtasks && taskData.subtasks.length > 0) {
    for (const st of taskData.subtasks) {
      const supaSt = transform.localTaskToSupabase(st, data.project_id);
      delete supaSt.id;
      supaSt.parent_task_id = data.id;
      await client.from('tasks').insert(supaSt);
    }
  }

  // Handle tags
  if (taskData.tags && taskData.tags.length > 0) {
    const tagRows = taskData.tags.map(t => ({
      task_id: data.id,
      tag_id: typeof t === 'string' ? t : t.id,
    }));
    await client.from('task_tags').insert(tagRows);
  }

  // Handle file paths
  if (taskData.filePaths && taskData.filePaths.length > 0) {
    const fileRows = taskData.filePaths.map(fp => ({ task_id: data.id, file_path: fp }));
    await client.from('task_files').insert(fileRows);
  }

  return data;
}

async function updateTask(taskId, updates) {
  const client = await supabaseClient.getClient();
  const supaUpdates = {};

  // Map camelCase to snake_case for known fields
  const fieldMap = {
    name: 'name', description: 'description', context: 'context',
    workNotes: 'work_notes', status: 'status', priority: 'priority',
    dueDate: 'due_date', scheduledDate: 'scheduled_date',
    scheduledTime: 'scheduled_time', startDate: 'start_date',
    endDate: 'end_date', estimatedMinutes: 'estimated_minutes',
    complexity: 'complexity', executionType: 'execution_type',
    assignedTo: 'assigned_to', assignee: 'assignee_name',
    waitingReason: 'waiting_reason', sortOrder: 'sort_order',
    completedAt: 'completed_at', projectId: 'project_id',
  };

  for (const [local, supa] of Object.entries(fieldMap)) {
    if (updates[local] !== undefined) {
      supaUpdates[supa] = updates[local];
    }
  }

  // Auto-set completed_at when marking done
  if (supaUpdates.status === 'done' && !supaUpdates.completed_at) {
    supaUpdates.completed_at = new Date().toISOString();
  }
  if (supaUpdates.status && supaUpdates.status !== 'done') {
    supaUpdates.completed_at = null;
  }

  const { data, error } = await client
    .from('tasks')
    .update(supaUpdates)
    .eq('id', taskId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteTask(taskId) {
  const client = await supabaseClient.getClient();
  const { error } = await client.from('tasks').delete().eq('id', taskId);
  if (error) throw error;
}

async function completeTask(taskId) {
  return updateTask(taskId, { status: 'done', completedAt: new Date().toISOString() });
}

async function createProject(projectData) {
  const client = await supabaseClient.getClient();
  const supaProject = transform.localProjectToSupabase(projectData, _teamId);
  delete supaProject.id;

  const { data, error } = await client
    .from('projects')
    .insert(supaProject)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateProject(projectId, updates) {
  const client = await supabaseClient.getClient();
  const supaUpdates = {};

  const fieldMap = {
    name: 'name', description: 'description', color: 'color',
    isInbox: 'is_inbox', status: 'status', goal: 'goal',
    categoryId: 'category_id', workingDirectory: 'working_directory',
  };

  for (const [local, supa] of Object.entries(fieldMap)) {
    if (updates[local] !== undefined) {
      supaUpdates[supa] = updates[local];
    }
  }

  if (supaUpdates.status) {
    supaUpdates.status = transform.localProjectToSupabase({ status: supaUpdates.status }, '').status;
  }

  const { data, error } = await client
    .from('projects')
    .update(supaUpdates)
    .eq('id', projectId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteProject(projectId) {
  const client = await supabaseClient.getClient();
  const { error } = await client.from('projects').delete().eq('id', projectId);
  if (error) throw error;
}

async function createSubtask(parentTaskId, subtaskData) {
  const client = await supabaseClient.getClient();
  // Get parent's project_id
  const { data: parent } = await client.from('tasks').select('project_id').eq('id', parentTaskId).single();
  if (!parent) throw new Error('Parent task not found');

  const supaTask = transform.localTaskToSupabase(subtaskData, parent.project_id);
  delete supaTask.id;
  supaTask.parent_task_id = parentTaskId;

  const { data, error } = await client.from('tasks').insert(supaTask).select().single();
  if (error) throw error;
  return data;
}

async function updateSubtask(subtaskId, updates) {
  return updateTask(subtaskId, updates);
}

async function deleteSubtask(subtaskId) {
  return deleteTask(subtaskId);
}

async function createTag(tagData) {
  const client = await supabaseClient.getClient();
  const supaTag = transform.localTagToSupabase(tagData, _teamId);
  delete supaTag.id;

  const { data, error } = await client.from('tags').insert(supaTag).select().single();
  if (error) throw error;
  return data;
}

async function updateTag(tagId, updates) {
  const client = await supabaseClient.getClient();
  const { data, error } = await client
    .from('tags')
    .update({ name: updates.name, color: updates.color })
    .eq('id', tagId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteTag(tagId) {
  const client = await supabaseClient.getClient();
  const { error } = await client.from('tags').delete().eq('id', tagId);
  if (error) throw error;
}

async function createCategory(catData) {
  const client = await supabaseClient.getClient();
  const supaCat = transform.localCategoryToSupabase(catData, _teamId);
  delete supaCat.id;

  const { data, error } = await client.from('categories').insert(supaCat).select().single();
  if (error) throw error;
  return data;
}

async function updateCategory(catId, updates) {
  const client = await supabaseClient.getClient();
  const supaUpdates = {};
  if (updates.name !== undefined) supaUpdates.name = updates.name;
  if (updates.color !== undefined) supaUpdates.color = updates.color;
  if (updates.order !== undefined) supaUpdates.sort_order = updates.order;
  if (updates.collapsed !== undefined) supaUpdates.collapsed = updates.collapsed;

  const { data, error } = await client
    .from('categories')
    .update(supaUpdates)
    .eq('id', catId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteCategory(catId) {
  const client = await supabaseClient.getClient();
  const { error } = await client.from('categories').delete().eq('id', catId);
  if (error) throw error;
}

async function createNotebook(notebookData) {
  const client = await supabaseClient.getClient();
  const supaNb = transform.localNotebookToSupabase(notebookData, notebookData.projectId);
  delete supaNb.id;

  const { data, error } = await client.from('notebooks').insert(supaNb).select().single();
  if (error) throw error;
  return data;
}

async function updateNotebook(notebookId, updates) {
  const client = await supabaseClient.getClient();
  const supaUpdates = {};
  if (updates.title !== undefined) supaUpdates.title = updates.title;
  if (updates.content !== undefined) supaUpdates.content = updates.content;
  if (updates.icon !== undefined) supaUpdates.icon = updates.icon;
  if (updates.pinned !== undefined) supaUpdates.pinned = updates.pinned;

  const { data, error } = await client
    .from('notebooks')
    .update(supaUpdates)
    .eq('id', notebookId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteNotebook(notebookId) {
  const client = await supabaseClient.getClient();
  const { error } = await client.from('notebooks').delete().eq('id', notebookId);
  if (error) throw error;
}

async function addRecapEntry(entryData) {
  const client = await supabaseClient.getClient();
  const supaEntry = transform.localRecapEntryToSupabase(entryData, _teamId, _userId);
  delete supaEntry.id;

  const { data, error } = await client.from('recap_entries').insert(supaEntry).select().single();
  if (error) throw error;

  // Handle tags
  if (entryData.tags && entryData.tags.length > 0) {
    const tagRows = entryData.tags.map(tag => ({ recap_entry_id: data.id, tag }));
    await client.from('recap_entry_tags').insert(tagRows);
  }

  return data;
}

async function saveRecap(recapData) {
  const client = await supabaseClient.getClient();
  const supaRecap = transform.localSavedRecapToSupabase(recapData, _teamId, _userId);
  delete supaRecap.id;

  const { data, error } = await client.from('saved_recaps').insert(supaRecap).select().single();
  if (error) throw error;
  return data;
}

async function updateWorkingOn(taskIds) {
  const client = await supabaseClient.getClient();
  const { data, error } = await client
    .from('user_preferences')
    .update({ working_on_task_ids: taskIds })
    .eq('user_id', _userId)
    .eq('team_id', _teamId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updatePreferences(updates) {
  const client = await supabaseClient.getClient();
  const supaUpdates = {};
  if (updates.theme !== undefined) supaUpdates.theme = updates.theme;
  if (updates.defaultView !== undefined) supaUpdates.default_view = updates.defaultView;
  if (updates.fontScale !== undefined) supaUpdates.font_scale = updates.fontScale;
  if (updates.favorites !== undefined) supaUpdates.favorites = updates.favorites;
  if (updates.workingOnTaskIds !== undefined) supaUpdates.working_on_task_ids = updates.workingOnTaskIds;

  const { data, error } = await client
    .from('user_preferences')
    .update(supaUpdates)
    .eq('user_id', _userId)
    .eq('team_id', _teamId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Sync: save-data write-through ───────────────────────────

/**
 * Sync local data changes to Supabase.
 * Called after local JSON save to push changes upstream.
 * Uses upsert for items with valid UUIDs.
 */
async function syncChanges(newData) {
  if (!_teamId || !_userId) return;

  const client = await supabaseClient.getClient();

  try {
    // Sync projects
    for (const project of newData.projects) {
      if (isUUID(project.id)) {
        const supaProject = transform.localProjectToSupabase(project, _teamId);
        supaProject.id = project.id;
        await client.from('projects').upsert(supaProject, { onConflict: 'id' });

        // Sync tasks within this project
        for (const task of (project.tasks || [])) {
          await syncTask(client, task, project.id);
        }

        // Sync notebooks
        for (const nb of (project.notebooks || [])) {
          if (isUUID(nb.id)) {
            const supaNb = transform.localNotebookToSupabase(nb, project.id);
            supaNb.id = nb.id;
            await client.from('notebooks').upsert(supaNb, { onConflict: 'id' });
          }
        }

        // Sync launchers
        for (const ln of (project.launchers || [])) {
          if (isUUID(ln.id)) {
            const supaLn = transform.localLauncherToSupabase(ln, project.id);
            supaLn.id = ln.id;
            await client.from('launchers').upsert(supaLn, { onConflict: 'id' });
          }
        }
      }
    }

    // Sync categories
    for (const cat of (newData.categories || [])) {
      if (isUUID(cat.id)) {
        const supaCat = transform.localCategoryToSupabase(cat, _teamId);
        supaCat.id = cat.id;
        await client.from('categories').upsert(supaCat, { onConflict: 'id' });
      }
    }

    // Sync tags
    for (const tag of (newData.tags || [])) {
      if (isUUID(tag.id)) {
        const supaTag = transform.localTagToSupabase(tag, _teamId);
        supaTag.id = tag.id;
        await client.from('tags').upsert(supaTag, { onConflict: 'id' });
      }
    }

    // Sync preferences
    if (newData.workingOnTaskIds || newData.favorites || newData.settings) {
      const prefUpdates = {};
      if (newData.workingOnTaskIds) prefUpdates.working_on_task_ids = newData.workingOnTaskIds.filter(isUUID);
      if (newData.favorites) prefUpdates.favorites = newData.favorites.filter(isUUID);
      if (newData.settings) {
        if (newData.settings.theme) prefUpdates.theme = newData.settings.theme;
        if (newData.settings.defaultView) prefUpdates.default_view = newData.settings.defaultView;
        if (newData.settings.fontScale) prefUpdates.font_scale = newData.settings.fontScale;
      }
      if (Object.keys(prefUpdates).length > 0) {
        await client.from('user_preferences')
          .update(prefUpdates)
          .eq('user_id', _userId)
          .eq('team_id', _teamId);
      }
    }
  } catch (err) {
    console.error('Supabase sync error (local save succeeded):', err.message);
  }
}

async function syncTask(client, task, projectId) {
  if (!isUUID(task.id)) return;

  const supaTask = transform.localTaskToSupabase(task, projectId);
  supaTask.id = task.id;
  await client.from('tasks').upsert(supaTask, { onConflict: 'id' });

  // Sync subtasks
  for (const st of (task.subtasks || [])) {
    if (isUUID(st.id)) {
      const supaSt = transform.localTaskToSupabase(st, projectId);
      supaSt.id = st.id;
      supaSt.parent_task_id = task.id;
      await client.from('tasks').upsert(supaSt, { onConflict: 'id' });
    }
  }
}

// ── Team Members & Invitations ──────────────────────────────

async function getTeamMembers() {
  const client = await supabaseClient.getClient();
  if (!_teamId) await init();

  const { data, error } = await client
    .from('team_members')
    .select('user_id, role, profiles(id, display_name, email)')
    .eq('team_id', _teamId);
  if (error) throw error;

  _teamMembers = (data || []).map(m => ({
    userId: m.user_id,
    role: m.role,
    displayName: m.profiles?.display_name || m.profiles?.email || 'Unknown',
    email: m.profiles?.email || '',
  }));

  return _teamMembers;
}

async function inviteByEmail(email, role = 'member') {
  const client = await supabaseClient.getClient();
  if (!_teamId) await init();

  const { data, error } = await client
    .from('team_invitations')
    .insert({
      team_id: _teamId,
      invited_by: _userId,
      email: email.trim().toLowerCase(),
      role,
    })
    .select()
    .single();
  if (error) throw error;

  // Send email notification (non-blocking — don't fail the invite if email fails)
  try {
    const { data: team } = await client.from('teams').select('name').eq('id', _teamId).single();
    const { data: profile } = await client.from('profiles').select('display_name').eq('id', _userId).single();

    await client.functions.invoke('send-invitation-email', {
      body: {
        email: email.trim().toLowerCase(),
        teamName: team?.name || 'a team',
        invitedByName: profile?.display_name || 'A teammate',
        role,
      },
    });
  } catch (emailErr) {
    console.error('Invitation email failed (invite still created):', emailErr.message);
  }

  return data;
}

async function getTeamInvitations() {
  const client = await supabaseClient.getClient();
  if (!_teamId) await init();

  const { data, error } = await client
    .from('team_invitations')
    .select('*')
    .eq('team_id', _teamId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getPendingInvitationsForMe() {
  const client = await supabaseClient.getClient();

  const { data, error } = await client.rpc('get_my_pending_invitations');
  if (error) throw error;
  return data || [];
}

async function acceptInvitation(invitationId) {
  const client = await supabaseClient.getClient();

  const { data, error } = await client.rpc('accept_invitation', {
    invitation_id: invitationId,
  });
  if (error) throw error;

  // Refresh team context after accepting
  if (data && data.team_id) {
    _teamId = data.team_id;
    _teamMembers = null; // bust cache
  }

  return data;
}

async function declineInvitation(invitationId) {
  const client = await supabaseClient.getClient();

  const { data, error } = await client
    .from('team_invitations')
    .update({ status: 'declined' })
    .eq('id', invitationId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Project Members ─────────────────────────────────────────

async function getProjectMembers(projectId) {
  const client = await supabaseClient.getClient();
  if (!_teamId) await init();

  const { data, error } = await client
    .from('project_members')
    .select('project_id, user_id, role, added_at, profiles:user_id(display_name, email)')
    .eq('project_id', projectId);
  if (error) throw error;
  return (data || []).map(m => ({
    projectId: m.project_id,
    userId: m.user_id,
    role: m.role,
    addedAt: m.added_at,
    displayName: m.profiles?.display_name || m.profiles?.email || 'Unknown',
    email: m.profiles?.email || '',
  }));
}

async function addProjectMember(projectId, userId, role = 'editor') {
  const client = await supabaseClient.getClient();
  if (!_teamId) await init();

  const { data, error } = await client
    .from('project_members')
    .upsert({
      project_id: projectId,
      user_id: userId,
      role,
      added_by: _userId,
    }, { onConflict: 'project_id,user_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateProjectMemberRole(projectId, userId, role) {
  const client = await supabaseClient.getClient();

  const { data, error } = await client
    .from('project_members')
    .update({ role })
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function removeProjectMember(projectId, userId) {
  const client = await supabaseClient.getClient();

  const { error } = await client
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId);
  if (error) throw error;
}

// ── Helpers ─────────────────────────────────────────────────

function isUUID(str) {
  return typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function saveLocalBackup(data) {
  try {
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to save local backup:', err.message);
  }
}

function isAuthenticated() {
  return !!_teamId && !!_userId;
}

function getTeamId() { return _teamId; }
function getUserId() { return _userId; }

module.exports = {
  init,
  loadAllData,
  isAuthenticated,
  getTeamId,
  getUserId,
  // Granular CRUD
  createTask,
  updateTask,
  deleteTask,
  completeTask,
  createProject,
  updateProject,
  deleteProject,
  createSubtask,
  updateSubtask,
  deleteSubtask,
  createTag,
  updateTag,
  deleteTag,
  createCategory,
  updateCategory,
  deleteCategory,
  createNotebook,
  updateNotebook,
  deleteNotebook,
  addRecapEntry,
  saveRecap,
  updateWorkingOn,
  updatePreferences,
  // Team & Invitations
  getTeamMembers,
  inviteByEmail,
  getTeamInvitations,
  getPendingInvitationsForMe,
  acceptInvitation,
  declineInvitation,
  // Project Members
  getProjectMembers,
  addProjectMember,
  updateProjectMemberRole,
  removeProjectMember,
  // Sync
  syncChanges,
};
