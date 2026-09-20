export class Notice {}
export class Plugin {}
export class Modal {}
export class PluginSettingTab {}
export class Setting {}
export class ItemView {}
export class FuzzySuggestModal {}
export class TFile {}
export class TFolder {}
export class MarkdownRenderer {
  static render() {
    return Promise.resolve();
  }
}
export function requestUrl() {
  throw new Error("requestUrl is not available in tests");
}
export function setIcon() {}
