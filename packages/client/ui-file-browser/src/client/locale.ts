/**
 * File browser namespace and dictionaries.
 * Keys: `fileBrowser.*` — sidebar button, listing states, and editor chrome.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'fileBrowser.label': '文件浏览',
  'fileBrowser.title': '浏览工作区',
  'fileBrowser.listError': '读取目录失败',
  'fileBrowser.readError': '读取文件失败',
  'fileBrowser.writeError': '写入文件失败',
  'fileBrowser.saving': '保存中...',
  'fileBrowser.saved': '已保存',
  'fileBrowser.noWorkspace': '此会话没有工作区目录',
  'fileBrowser.emptyDir': '此目录为空',
  'fileBrowser.loading': '正在加载...',
  'fileBrowser.cancel': '取消',
  'fileBrowser.save': '保存',
  'fileBrowser.edit': '编辑',
  'fileBrowser.editing': '编辑中',
  'fileBrowser.editAria': '编辑文件',
  'fileBrowser.saveAria': '保存文件',
  'fileBrowser.cancelAria': '取消编辑',
  'fileBrowser.back': '返回',
  'fileBrowser.openInDesktop': '在桌面中打开',
} satisfies Record<string, string>

/** The file browser namespace key union. */
export type FileBrowserKey = keyof typeof zh

/** English dictionary, checked complete against the Chinese key set. */
export const en = {
  'fileBrowser.label': 'Files',
  'fileBrowser.title': 'Browse workspace',
  'fileBrowser.listError': 'Failed to read directory',
  'fileBrowser.readError': 'Failed to read file',
  'fileBrowser.writeError': 'Failed to write file',
  'fileBrowser.saving': 'Saving...',
  'fileBrowser.saved': 'Saved',
  'fileBrowser.noWorkspace': 'This session has no workspace directory',
  'fileBrowser.emptyDir': 'This directory is empty',
  'fileBrowser.loading': 'Loading...',
  'fileBrowser.cancel': 'Cancel',
  'fileBrowser.save': 'Save',
  'fileBrowser.edit': 'Edit',
  'fileBrowser.editing': 'Editing',
  'fileBrowser.editAria': 'Edit file',
  'fileBrowser.saveAria': 'Save file',
  'fileBrowser.cancelAria': 'Cancel editing',
  'fileBrowser.back': 'Back',
  'fileBrowser.openInDesktop': 'Open in Desktop',
} satisfies Record<FileBrowserKey, string>
