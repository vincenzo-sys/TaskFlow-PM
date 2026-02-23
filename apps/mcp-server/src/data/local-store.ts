import fs from 'fs';
import path from 'path';
import os from 'os';
import { DataStore } from './store.js';

const DATA_PATH = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'taskflow-pm',
  'taskflow-data.json'
);

export class LocalDataStore implements DataStore {
  loadData(): any {
    try {
      if (fs.existsSync(DATA_PATH)) {
        return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
      }
    } catch (error) {
      console.error('Error loading data:', error);
    }
    return { projects: [], tags: [], settings: {} };
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
