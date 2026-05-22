export interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

let api: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi {
  if (!api) {
    if (typeof acquireVsCodeApi !== 'undefined') {
      api = acquireVsCodeApi() as VsCodeApi;
    } else {
      api = {
        postMessage: (msg) => console.log('[DEV] postMessage:', msg),
        getState: () => ({}),
        setState: (s) => console.log('[DEV] setState:', s),
      };
    }
  }
  return api;
}

declare function acquireVsCodeApi(): unknown;