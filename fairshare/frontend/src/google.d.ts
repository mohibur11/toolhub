// Minimal typings for Google Identity Services (accounts.google.com/gsi/client) and the Google Picker.

interface GoogleTokenResponse {
  access_token: string;
  expires_in: string | number;
  scope: string;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void;
}

interface GooglePickerDocsView {
  setMode(mode: unknown): GooglePickerDocsView;
  setFileIds(ids: string): GooglePickerDocsView;
  setOwnedByMe(owned: boolean): GooglePickerDocsView;
  setQuery(query: string): GooglePickerDocsView;
}

interface GooglePickerBuilder {
  setAppId(id: string): GooglePickerBuilder;
  setDeveloperKey(key: string): GooglePickerBuilder;
  setOAuthToken(token: string): GooglePickerBuilder;
  addView(view: GooglePickerDocsView): GooglePickerBuilder;
  setTitle(title: string): GooglePickerBuilder;
  enableFeature(feature: unknown): GooglePickerBuilder;
  setCallback(cb: (data: Record<string, unknown>) => void): GooglePickerBuilder;
  build(): { setVisible(visible: boolean): void };
}

interface GooglePickerNamespace {
  DocsView: new (viewId: unknown) => GooglePickerDocsView;
  PickerBuilder: new () => GooglePickerBuilder;
  ViewId: { SPREADSHEETS: unknown };
  DocsViewMode: { LIST: unknown };
  Feature: { MULTISELECT_ENABLED: unknown };
  Action: { PICKED: string; CANCEL: string };
  Response: { ACTION: string; DOCUMENTS: string };
  Document: { ID: string; NAME: string };
}

interface Window {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient(config: {
          client_id: string;
          scope: string;
          callback: (res: GoogleTokenResponse) => void;
          error_callback?: (err: { type?: string; message?: string }) => void;
        }): GoogleTokenClient;
        hasGrantedAllScopes(res: GoogleTokenResponse, ...scopes: string[]): boolean;
      };
    };
    picker?: GooglePickerNamespace;
  };
  gapi?: {
    load(name: string, options: { callback: () => void; onerror?: () => void; timeout?: number; ontimeout?: () => void }): void;
  };
  FAIRSHARE_CONFIG?: { googleClientId?: string; googleApiKey?: string };
}
