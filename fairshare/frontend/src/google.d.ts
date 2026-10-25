// Minimal typings for Google Identity Services (https://accounts.google.com/gsi/client).
interface GoogleCredentialResponse {
  credential: string;
}

interface Window {
  google?: {
    accounts: {
      id: {
        initialize(options: {
          client_id: string;
          callback: (res: GoogleCredentialResponse) => void;
          auto_select?: boolean;
          cancel_on_tap_outside?: boolean;
        }): void;
        renderButton(el: HTMLElement, options: Record<string, unknown>): void;
        prompt(): void;
        disableAutoSelect(): void;
      };
    };
  };
}

interface Window {
  FAIRSHARE_CONFIG?: { googleClientId?: string; apiUrl?: string };
}
