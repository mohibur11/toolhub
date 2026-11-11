// Google's file picker. With the drive.file permission, FairShare can only open a sheet someone shared with you
// after you select it here (once per group). It never sees your other files.
import { GOOGLE_API_KEY, GOOGLE_APP_ID } from '../config';
import { accessToken } from './auth';

let loading: Promise<void> | null = null;

function loadPicker(): Promise<void> {
  if (window.google?.picker) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const failed = () => reject(new Error("Couldn't load Google's file picker. Check your connection and try again."));
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.onerror = failed;
    script.onload = () => window.gapi?.load('picker', { callback: () => resolve(), onerror: failed, timeout: 20000, ontimeout: failed });
    document.head.append(script);
  }).catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

export interface PickedFile {
  id: string;
  name: string;
}

/**
 * Open the picker. With `fileId`, it lists only that group's sheet (opening an invite link); without, it searches
 * the FairShare sheets shared with you and allows picking several.
 */
export async function pickGroupSheets(opts: { fileId?: string } = {}): Promise<PickedFile[]> {
  const apiKey = GOOGLE_API_KEY;
  const appId = GOOGLE_APP_ID;
  if (!apiKey || !appId) throw new Error('FairShare is not configured for the file picker (missing API key).');
  const token = accessToken();
  await loadPicker();
  const p = window.google!.picker!;
  const view = new p.DocsView(p.ViewId.SPREADSHEETS).setMode(p.DocsViewMode.LIST);
  if (opts.fileId) view.setFileIds(opts.fileId);
  else view.setOwnedByMe(false).setQuery('FairShare');
  return new Promise((resolve) => {
    const builder = new p.PickerBuilder()
      .setAppId(appId)
      .setDeveloperKey(apiKey)
      .setOAuthToken(token)
      .addView(view)
      .setTitle(opts.fileId ? 'Select the group to open it' : 'FairShare groups shared with you')
      .setCallback((data) => {
        const action = data[p.Response.ACTION];
        if (action === p.Action.PICKED) {
          const docs = (data[p.Response.DOCUMENTS] as Record<string, string>[] | undefined) ?? [];
          resolve(docs.map((d) => ({ id: d[p.Document.ID], name: d[p.Document.NAME] })));
        } else if (action === p.Action.CANCEL) resolve([]);
      });
    if (!opts.fileId) builder.enableFeature(p.Feature.MULTISELECT_ENABLED);
    builder.build().setVisible(true);
  });
}
