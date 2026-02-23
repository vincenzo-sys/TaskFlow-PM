export interface DataStore {
  getRawData(): any;
  saveRawData(data: any): void;
  loadData(): any;
  saveData(data: any): boolean;
}
