import fs from 'fs';
import path from 'path';
import os from 'os';
import { DataStore } from './store.js';
import { autoRollTasks } from '../helpers.js';

// Electron userData path: @taskflow/electron (from monorepo package name)
const DATA_PATH = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  '@taskflow',
  'electron',
  'taskflow-data.json'
);

export class LocalDataStore implements DataStore {
  loadData(): any {
    let data: any = { projects: [], tags: [], settings: {} };
    try {
      if (fs.existsSync(DATA_PATH)) {
        data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
      }
    } catch (error) {
      console.error('Error loading data:', error);
      return data;
    }

    // Auto-roll stale tasks forward to today (mirrors Electron renderer behavior)
    const rolled = autoRollTasks(data);
    if (rolled > 0) {
      console.error(`Auto-rolled ${rolled} stale task(s) forward to today`);
    }

    return data;
  }

  saveData(data: any): boolean {
    try {
      const dir = path.dirname(DATA_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error('Error saving data:', error);
      return false;
    }
  }

  getRawData(): any {
    return this.loadData();
  }

  saveRawData(data: any): void {
    this.saveData(data);
  }
}
