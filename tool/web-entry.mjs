import * as sdk from 'locho_web';
import { createBridge, createCredentialStore } from './web-bridge.mjs';

// Resolve beside this module so Flutter --base-href deployments also work.
const wasm = new URL('./locho_web_bg.wasm', import.meta.url);
const store = createCredentialStore();
globalThis.lochoBridge = {
  ...createBridge(sdk, () => sdk.initializeLocho(wasm)),
  readCredentials: () => store.read(),
  replaceCredentials: (value) => store.replace(value),
};
