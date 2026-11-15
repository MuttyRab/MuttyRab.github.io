'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('app:info'),
  listTools: () => ipcRenderer.invoke('catalog:list'),
  pick: (opts) => ipcRenderer.invoke('dialog:pick', opts),
  run: (req) => ipcRenderer.invoke('tool:run', req),
  cancel: (runId) => ipcRenderer.invoke('tool:cancel', { runId }),
  stdin: (runId, text) => ipcRenderer.invoke('tool:stdin', { runId, text }),
  activate: (key) => ipcRenderer.invoke('license:activate', { key }),
  deactivate: () => ipcRenderer.invoke('license:deactivate'),
  open: (target) => ipcRenderer.invoke('shell:open', { target }),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return null; } },
  mcpInfo: () => ipcRenderer.invoke('mcp:info'),
  mcpInstall: (client) => ipcRenderer.invoke('mcp:install', { client }),
  copy: (text) => ipcRenderer.invoke('clipboard:write', { text }),
  onStatus: on('run:status'),
  onOutput: on('run:output'),
  onExit: on('run:exit'),
  onLicenseChanged: on('license:changed'),
  onCatalogChanged: on('catalog:changed'),
});
