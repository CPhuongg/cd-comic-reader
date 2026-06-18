const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_INVOKE = [
  'open-file', 'open-folder', 'read-folder', 'read-cbz',
  'get-folder-thumbnail', 'get-cbz-thumbnail',
  'fetch-web-chapter', 'save-progress', 'load-progress',
  'history-add', 'history-get', 'history-remove', 'history-clear'
];

const ALLOWED_SEND = ['win-minimize', 'win-maximize', 'win-close'];

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, ...args) => {
    if (!ALLOWED_INVOKE.includes(channel)) throw new Error(`IPC channel not allowed: ${channel}`);
    return ipcRenderer.invoke(channel, ...args);
  },
  send: (channel, ...args) => {
    if (!ALLOWED_SEND.includes(channel)) throw new Error(`IPC channel not allowed: ${channel}`);
    ipcRenderer.send(channel, ...args);
  }
});
