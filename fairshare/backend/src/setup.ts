// Run once from the Apps Script editor (select "setup" -> Run). Safe to re-run.
import { ensureRegistryTabs } from './registry';

export function setup(): string {
  const props = PropertiesService.getScriptProperties();
  const log: string[] = [];

  let registryId = props.getProperty('REGISTRY_SHEET_ID');
  if (!registryId) {
    const ss = SpreadsheetApp.create('FairShare Registry');
    registryId = ss.getId();
    props.setProperty('REGISTRY_SHEET_ID', registryId);
    log.push(`Created registry sheet: ${ss.getUrl()}`);
  }
  const ss = SpreadsheetApp.openById(registryId);
  ensureRegistryTabs(ss);
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0) ss.deleteSheet(blank);

  if (!props.getProperty('RECEIPTS_FOLDER_ID')) {
    const folder = DriveApp.createFolder('FairShare Receipts');
    props.setProperty('RECEIPTS_FOLDER_ID', folder.getId());
    log.push(`Created receipts folder: ${folder.getUrl()}`);
  }

  if (!props.getProperty('SESSION_SECRET')) {
    props.setProperty('SESSION_SECRET', Utilities.getUuid() + Utilities.getUuid());
    log.push('Generated session secret');
  }

  props.setProperty('OWNER_EMAIL', Session.getEffectiveUser().getEmail());
  log.push(`Owner email: ${props.getProperty('OWNER_EMAIL')}`);

  if (!props.getProperty('GOOGLE_CLIENT_ID'))
    log.push('ACTION NEEDED: add script property GOOGLE_CLIENT_ID (Project Settings -> Script properties)');

  const msg = log.join('\n');
  console.log(msg);
  return msg;
}
