// Weekly snapshot of the registry and every group spreadsheet into "FairShare/Backups".
// Installed as a time trigger by setup(); can also be run by hand from the Apps Script editor.
import { nowIso, prop } from './config';
import { allGroups } from './registry';

const KEEP = 8; // weekly snapshots to keep (~2 months)
const PREFIX = 'FairShare backup ';
const TIME_BUDGET_MS = 5 * 60 * 1000; // Apps Script stops executions at 6 minutes

export function weeklyBackup(): string {
  const started = Date.now();
  const root = DriveApp.getFolderById(prop('BACKUP_FOLDER_ID'));
  // "YYYY-MM-DD HH-mm" sorts chronologically by name.
  const folder = root.createFolder(PREFIX + nowIso().slice(0, 16).replace('T', ' ').replace(':', '-'));

  DriveApp.getFileById(prop('REGISTRY_SHEET_ID')).makeCopy('FairShare Registry', folder);
  let copied = 0;
  const problems: string[] = [];
  for (const g of allGroups()) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      problems.push('time limit reached; remaining groups were skipped');
      break;
    }
    try {
      DriveApp.getFileById(g.sheetId).makeCopy(`${g.name} (${g.groupId.slice(0, 8)})`, folder);
      copied++;
    } catch (e) {
      problems.push(`group ${g.groupId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const backups: GoogleAppsScript.Drive.Folder[] = [];
  const it = root.getFolders();
  while (it.hasNext()) backups.push(it.next());
  backups
    .filter((f) => f.getName().startsWith(PREFIX))
    .sort((a, b) => b.getName().localeCompare(a.getName()))
    .slice(KEEP)
    .forEach((f) => f.setTrashed(true));

  const msg = `Backup ${folder.getName()}: registry + ${copied} group(s)` + (problems.length ? `. Problems: ${problems.join('; ')}` : '');
  console.log(msg);
  return msg;
}
