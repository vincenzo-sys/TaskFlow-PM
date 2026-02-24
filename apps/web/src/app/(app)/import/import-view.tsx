'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { from } from '@/lib/supabase/typed-client';
import { useToast } from '@/components/toast';
import {
  transformLocalToSupabase,
  type LocalData,
  type TransformResult,
} from '@taskflow/shared/logic';

type ImportStep = 'upload' | 'preview' | 'importing' | 'done' | 'error';

interface ImportViewProps {
  teamId: string;
  userId: string;
}

export function ImportView({ teamId, userId }: ImportViewProps) {
  const [step, setStep] = useState<ImportStep>('upload');
  const [result, setResult] = useState<TransformResult | null>(null);
  const [progress, setProgress] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { showToast } = useToast();
  const supabase = getSupabaseBrowserClient();

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const local: LocalData = JSON.parse(text);

      if (!local.projects || !Array.isArray(local.projects)) {
        throw new Error('Invalid file: missing "projects" array');
      }

      const transformed = transformLocalToSupabase(local, teamId, userId);
      setResult(transformed);
      setStep('preview');
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Failed to parse file');
      setStep('error');
    }
  }, [teamId, userId]);

  const runImport = useCallback(async () => {
    if (!result) return;
    setStep('importing');

    try {
      // Insert in dependency order with batching

      if (result.categories.length > 0) {
        setProgress(`Importing ${result.categories.length} categories...`);
        const { error } = await from(supabase, 'categories').insert(result.categories as any);
        if (error) throw new Error(`Categories: ${error.message}`);
      }

      if (result.tags.length > 0) {
        setProgress(`Importing ${result.tags.length} tags...`);
        const { error } = await from(supabase, 'tags').insert(result.tags as any);
        if (error) throw new Error(`Tags: ${error.message}`);
      }

      if (result.projects.length > 0) {
        setProgress(`Importing ${result.projects.length} projects...`);
        const { error } = await from(supabase, 'projects').insert(result.projects as any);
        if (error) throw new Error(`Projects: ${error.message}`);
      }

      // Tasks in batches of 100 (some users have hundreds)
      if (result.tasks.length > 0) {
        const batches = chunk(result.tasks, 100);
        for (let i = 0; i < batches.length; i++) {
          setProgress(`Importing tasks (${i * 100 + batches[i].length}/${result.tasks.length})...`);
          const { error } = await from(supabase, 'tasks').insert(batches[i] as any);
          if (error) throw new Error(`Tasks batch ${i + 1}: ${error.message}`);
        }
      }

      if (result.taskFiles.length > 0) {
        setProgress(`Importing ${result.taskFiles.length} file references...`);
        const batches = chunk(result.taskFiles, 100);
        for (const batch of batches) {
          const { error } = await from(supabase, 'task_files').insert(batch as any);
          if (error) throw new Error(`Task files: ${error.message}`);
        }
      }

      if (result.taskTags.length > 0) {
        setProgress(`Importing ${result.taskTags.length} task-tag links...`);
        const { error } = await from(supabase, 'task_tags').insert(result.taskTags as any);
        if (error) throw new Error(`Task tags: ${error.message}`);
      }

      if (result.taskDependencies.length > 0) {
        setProgress(`Importing ${result.taskDependencies.length} dependencies...`);
        const { error } = await from(supabase, 'task_dependencies').insert(result.taskDependencies as any);
        if (error) throw new Error(`Dependencies: ${error.message}`);
      }

      if (result.notebooks.length > 0) {
        setProgress(`Importing ${result.notebooks.length} notebooks...`);
        const { error } = await from(supabase, 'notebooks').insert(result.notebooks as any);
        if (error) throw new Error(`Notebooks: ${error.message}`);
      }

      if (result.launchers.length > 0) {
        setProgress(`Importing ${result.launchers.length} launchers...`);
        const { error } = await from(supabase, 'launchers').insert(result.launchers as any);
        if (error) throw new Error(`Launchers: ${error.message}`);
      }

      if (result.recapEntries.length > 0) {
        setProgress(`Importing ${result.recapEntries.length} recap entries...`);
        const { error } = await from(supabase, 'recap_entries').insert(result.recapEntries as any);
        if (error) throw new Error(`Recap entries: ${error.message}`);
      }

      if (result.recapEntryTags.length > 0) {
        setProgress('Importing recap entry tags...');
        const { error } = await from(supabase, 'recap_entry_tags').insert(result.recapEntryTags as any);
        if (error) throw new Error(`Recap tags: ${error.message}`);
      }

      if (result.savedRecaps.length > 0) {
        setProgress(`Importing ${result.savedRecaps.length} saved recaps...`);
        const { error } = await from(supabase, 'saved_recaps').insert(result.savedRecaps as any);
        if (error) throw new Error(`Saved recaps: ${error.message}`);
      }

      // Update working-on task IDs in preferences
      if (result.workingOnTaskIds.length > 0) {
        setProgress('Setting active tasks...');
        await from(supabase, 'user_preferences')
          .update({ working_on_task_ids: result.workingOnTaskIds } as any)
          .eq('user_id', userId)
          .eq('team_id', teamId);
      }

      setStep('done');
      showToast('Import complete!', 'success');
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Import failed');
      setStep('error');
    }
  }, [result, supabase, teamId, userId, showToast]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-bold text-paper-900">Import from Desktop App</h1>
      <p className="mt-2 text-sm text-paper-500">
        Upload your <code className="rounded bg-paper-100 px-1.5 py-0.5 text-xs font-mono">taskflow-data.json</code> file
        from the Electron app to bring your data into the web version.
      </p>

      {/* Upload Step */}
      {step === 'upload' && (
        <div className="mt-8">
          <label
            htmlFor="file-upload"
            className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-paper-300 bg-paper-50 px-6 py-12 transition hover:border-indigo-400 hover:bg-indigo-50/30"
          >
            <svg className="h-10 w-10 text-paper-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <span className="mt-3 text-sm font-medium text-paper-700">
              Click to upload or drag and drop
            </span>
            <span className="mt-1 text-xs text-paper-400">taskflow-data.json</span>
          </label>
          <input
            ref={fileRef}
            id="file-upload"
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFile}
          />

          <div className="mt-6 rounded-lg border border-paper-200 bg-paper-50 p-4">
            <h3 className="text-sm font-medium text-paper-700">Where to find your data file</h3>
            <p className="mt-1 text-xs text-paper-500">
              The file is at <code className="rounded bg-paper-100 px-1 py-0.5">%APPDATA%/taskflow-pm/taskflow-data.json</code> on
              Windows or <code className="rounded bg-paper-100 px-1 py-0.5">~/Library/Application Support/taskflow-pm/taskflow-data.json</code> on
              macOS.
            </p>
          </div>
        </div>
      )}

      {/* Preview Step */}
      {step === 'preview' && result && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-paper-800">Preview</h2>
          <p className="mt-1 text-sm text-paper-500">
            Here&apos;s what will be imported. Review and click Import to proceed.
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <StatCard label="Projects" count={result.stats.projects} />
            <StatCard label="Tasks" count={result.stats.tasks} />
            <StatCard label="Subtasks" count={result.stats.subtasks} />
            <StatCard label="Categories" count={result.stats.categories} />
            <StatCard label="Tags" count={result.stats.tags} />
            <StatCard label="Notebooks" count={result.stats.notebooks} />
            <StatCard label="Launchers" count={result.stats.launchers} />
            <StatCard label="Dependencies" count={result.stats.dependencies} />
            <StatCard label="File refs" count={result.stats.files} />
            <StatCard label="Recap entries" count={result.stats.recapEntries} />
            <StatCard label="Saved recaps" count={result.stats.savedRecaps} />
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={runImport}
              className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700"
            >
              Import All
            </button>
            <button
              onClick={() => { setStep('upload'); setResult(null); }}
              className="rounded-lg border border-paper-300 px-5 py-2.5 text-sm font-medium text-paper-700 transition hover:bg-paper-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Importing Step */}
      {step === 'importing' && (
        <div className="mt-8 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-paper-200 border-t-indigo-600" />
          <p className="mt-4 text-sm font-medium text-paper-700">{progress}</p>
        </div>
      )}

      {/* Done Step */}
      {step === 'done' && result && (
        <div className="mt-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
            <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h2 className="mt-4 text-lg font-semibold text-paper-900">Import Complete</h2>
          <p className="mt-1 text-sm text-paper-500">
            {result.stats.projects} projects and {result.stats.tasks + result.stats.subtasks} tasks imported.
          </p>
          <button
            onClick={() => router.push('/today')}
            className="mt-6 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700"
          >
            Go to Today
          </button>
        </div>
      )}

      {/* Error Step */}
      {step === 'error' && (
        <div className="mt-8">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <h3 className="text-sm font-medium text-red-800">Import Error</h3>
            <p className="mt-1 text-sm text-red-600">{errorMsg}</p>
          </div>
          <button
            onClick={() => { setStep('upload'); setResult(null); setErrorMsg(''); }}
            className="mt-4 rounded-lg border border-paper-300 px-5 py-2.5 text-sm font-medium text-paper-700 transition hover:bg-paper-100"
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, count }: { label: string; count: number }) {
  if (count === 0) return null;
  return (
    <div className="rounded-lg border border-paper-200 bg-white px-4 py-3">
      <p className="text-2xl font-bold text-paper-900">{count}</p>
      <p className="text-xs text-paper-500">{label}</p>
    </div>
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}
