// Run once from the Apps Script editor (select "setup" -> Run). Safe to re-run.
// Creates, in the owner's Drive:
//   FairShare/
//     FairShare Registry   (spreadsheet: users, groups, memberships)
//     Groups/              (one spreadsheet per group, created by the app)
//     Receipts/
//     Backups/             (weekly snapshots, last 8 kept)
import { ensureRegistryTabs } from './registry';
import type { PropName } from './config';

const DEFAULT_APP_URL = 'https://mohibur11.github.io/toolhub/tools/fairshare/';

export function setup(): string {
  const props = PropertiesService.getScriptProperties();
  const log: string[] = [];

  const folderProp = (name: PropName, title: string, parent: () => GoogleAppsScript.Drive.Folder) => {
    let id = props.getProperty(name);
    if (!id) {
      const folder = parent().createFolder(title);
      id = folder.getId();
      props.setProperty(name, id);
      log.push(`Created folder ${title}: ${folder.getUrl()}`);
    }
    return DriveApp.getFolderById(id);
  };

  const appFolder = folderProp('APP_FOLDER_ID', 'FairShare', () => DriveApp.getRootFolder());

  let registryId = props.getProperty('REGISTRY_SHEET_ID');
  if (!registryId) {
    const created = SpreadsheetApp.create('FairShare Registry');
    registryId = created.getId();
    DriveApp.getFileById(registryId).moveTo(appFolder);
    props.setProperty('REGISTRY_SHEET_ID', registryId);
    log.push(`Created registry sheet: ${created.getUrl()}`);
  }
  const ss = SpreadsheetApp.openById(registryId);
  ensureRegistryTabs(ss);
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0) ss.deleteSheet(blank);

  folderProp('GROUPS_FOLDER_ID', 'Groups', () => appFolder);
  folderProp('RECEIPTS_FOLDER_ID', 'Receipts', () => appFolder);
  folderProp('BACKUP_FOLDER_ID', 'Backups', () => appFolder);

  if (!ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'weeklyBackup')) {
    ScriptApp.newTrigger('weeklyBackup').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
    log.push('Scheduled weekly backup (Sundays, ~3 AM script time)');
  }

  if (!props.getProperty('SESSION_SECRET')) {
    props.setProperty('SESSION_SECRET', Utilities.getUuid() + Utilities.getUuid());
    log.push('Generated session secret');
  }

  // Link used in "you were added to a group" emails. Change the script property if the app moves.
  if (!props.getProperty('APP_URL')) {
    props.setProperty('APP_URL', DEFAULT_APP_URL);
    log.push(`App link for emails: ${DEFAULT_APP_URL}`);
  }

  props.setProperty('OWNER_EMAIL', Session.getEffectiveUser().getEmail());
  log.push(`Owner email: ${props.getProperty('OWNER_EMAIL')}`);

  if (!props.getProperty('GOOGLE_CLIENT_ID'))
    log.push('ACTION NEEDED: add script property GOOGLE_CLIENT_ID (Project Settings -> Script properties)');

  const msg = log.join('\n') || 'Everything is already set up.';
  console.log(msg);
  return msg;
}
