/**
 * Google Picker for Drive (`drive.file` scope). Loads gapi in the browser and
 * returns the files the user granted this app.
 */
export type PickedDriveDoc = { id: string; name: string; mimeType: string };

type GapiLoader = { load: (lib: string, cb: () => void) => void };

type PickerDoc = { id?: string; name?: string; mimeType?: string };

type PickerData = {
  action?: string;
  docs?: PickerDoc[];
};

type DocsView = {
  setIncludeFolders: (v: boolean) => DocsView;
  setSelectFolderEnabled: (v: boolean) => DocsView;
};

type PickerBuilder = {
  addView: (view: unknown) => PickerBuilder;
  enableFeature: (feature: unknown) => PickerBuilder;
  setOAuthToken: (token: string) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setAppId: (id: string) => PickerBuilder;
  setMaxItems: (n: number) => PickerBuilder;
  setCallback: (cb: (data: PickerData) => void) => PickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
};

type GooglePickerNs = {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId?: string) => DocsView;
  ViewId: { DOCS: string };
  Feature: { MULTISELECT_ENABLED: string };
  Action: { PICKED: string; CANCEL: string };
};

function loadScript(src: string): Promise<void> {
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing) {
    return existing.getAttribute('data-loaded') === '1'
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          existing.addEventListener('load', () => resolve());
          existing.addEventListener('error', () => reject(new Error('Failed to load Google Picker')));
        });
  }
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => {
      el.setAttribute('data-loaded', '1');
      resolve();
    };
    el.onerror = () => reject(new Error('Failed to load Google Picker'));
    document.head.appendChild(el);
  });
}

function gapi(): GapiLoader {
  const w = window as unknown as { gapi?: GapiLoader };
  if (!w.gapi?.load) throw new Error('Google API client is not loaded');
  return w.gapi;
}

function pickerNs(): GooglePickerNs {
  const w = window as unknown as { google?: { picker?: GooglePickerNs } };
  if (!w.google?.picker) throw new Error('Google Picker is not loaded');
  return w.google.picker;
}

export async function openGoogleDrivePicker(opts: {
  accessToken: string;
  apiKey: string;
  appId: string;
  maxItems: number;
}): Promise<PickedDriveDoc[]> {
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise<void>((resolve, reject) => {
    try {
      gapi().load('picker', () => resolve());
    } catch (e) {
      reject(e);
    }
  });
  const gp = pickerNs();
  return new Promise((resolve, reject) => {
    const view = new gp.DocsView(gp.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(true);
    const picker = new gp.PickerBuilder()
      .addView(view)
      .enableFeature(gp.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(opts.accessToken)
      .setDeveloperKey(opts.apiKey)
      .setAppId(opts.appId)
      .setMaxItems(opts.maxItems)
      .setCallback((data) => {
        const action = String(data?.action ?? '');
        if (action === gp.Action.CANCEL || action === 'cancel') {
          resolve([]);
          return;
        }
        if (action !== gp.Action.PICKED && action !== 'picked') return;
        const docs = Array.isArray(data?.docs) ? data.docs : [];
        const out: PickedDriveDoc[] = [];
        for (const doc of docs) {
          const id = String(doc.id ?? '').trim();
          if (!id) continue;
          out.push({
            id,
            name: String(doc.name ?? id).trim() || id,
            mimeType: String(doc.mimeType ?? 'application/octet-stream')
          });
        }
        resolve(out);
      })
      .build();
    try {
      picker.setVisible(true);
    } catch (e) {
      reject(e);
    }
  });
}
