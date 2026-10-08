import type { WebToHost } from '../shared/messages';

declare function acquireVsCodeApi(): { postMessage(m: unknown): void };
const api = acquireVsCodeApi();
export const post = (m: WebToHost) => api.postMessage(m);
