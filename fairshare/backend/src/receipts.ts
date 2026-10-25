// Receipts live privately in the app owner's Drive. Members fetch them through the API,
// so no public sharing links are ever created.
import type { ApiActions, User } from '../../shared/types';
import { newId, prop } from './config';
import { ApiError, invalid } from './errors';
import { requireMember } from './registry';

type Req<A extends keyof ApiActions> = ApiActions[A]['req'];

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BASE64 = 4_000_000; // ~3 MB file

function groupFolder(groupId: string) {
  const root = DriveApp.getFolderById(prop('RECEIPTS_FOLDER_ID'));
  const it = root.getFoldersByName(groupId);
  return it.hasNext() ? it.next() : root.createFolder(groupId);
}

export function uploadReceipt(user: User, req: Req<'uploadReceipt'>) {
  requireMember(req.groupId, user.email);
  if (!ALLOWED.includes(req.mimeType)) invalid('Receipt must be a JPEG, PNG or WebP image');
  if (!req.base64 || req.base64.length > MAX_BASE64) invalid('Receipt image is too large');
  const ext = req.mimeType.split('/')[1].replace('jpeg', 'jpg');
  const blob = Utilities.newBlob(Utilities.base64Decode(req.base64), req.mimeType, `${req.groupId}__${newId()}.${ext}`);
  const file = groupFolder(req.groupId).createFile(blob);
  file.setDescription(`Uploaded by ${user.email}`);
  return { fileId: file.getId() };
}

export function getReceipt(user: User, req: Req<'getReceipt'>) {
  requireMember(req.groupId, user.email);
  let file: GoogleAppsScript.Drive.File;
  try {
    file = DriveApp.getFileById(req.fileId);
  } catch {
    throw new ApiError('NOT_FOUND', 'Receipt not found');
  }
  // File names are prefixed with the group id; refuse files from other groups.
  if (!file.getName().startsWith(`${req.groupId}__`)) throw new ApiError('FORBIDDEN', 'Receipt belongs to another group');
  const blob = file.getBlob();
  return { base64: Utilities.base64Encode(blob.getBytes()), mimeType: blob.getContentType() ?? 'image/jpeg' };
}
