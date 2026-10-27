import css from "../app.css?inline";

type StyleTarget = Document | ShadowRoot;

let shadowCss: string | undefined;
let shadowSheet: CSSStyleSheet | undefined;
let documentStylesInjected = false;

/**
 * Adds a sheet to `adoptedStyleSheets` without assuming it is a real array:
 * some pages patch or polyfill it with a non-iterable object. Returns false
 * when adoption isn't possible so the caller can fall back to a <style> tag.
 */
function adopt(target: StyleTarget, sheet: CSSStyleSheet): boolean {
  try {
    const current = target.adoptedStyleSheets as unknown;
    if (Array.isArray(current) || (current && Symbol.iterator in (current as object))) {
      const sheets = Array.from(current as Iterable<CSSStyleSheet>);
      if (!sheets.includes(sheet)) target.adoptedStyleSheets = [...sheets, sheet];
      return true;
    }
    if (current === undefined || current === null) {
      target.adoptedStyleSheets = [sheet];
      return Array.from(target.adoptedStyleSheets ?? []).includes(sheet);
    }
  } catch (err) {
    console.warn("[camera-plus-card] adoptedStyleSheets unavailable, using <style>", err);
  }
  return false;
}

function appendStyle(parent: Node, text: string): void {
  const style = document.createElement("style");
  style.textContent = text;
  parent.appendChild(style);
}

/**
 * `@property` rules are ignored inside shadow roots, but Tailwind v4 relies
 * on them for the initial values of its `--tw-*` variables (shadows, rings,
 * transforms). We split them off and register them on the document once;
 * they're namespaced, so they can't affect HA's own styles.
 */
function prepare(): void {
  if (shadowCss !== undefined) return;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);

  const propertyRules: string[] = [];
  for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
    const rule = sheet.cssRules[i];
    if (typeof CSSPropertyRule !== "undefined" && rule instanceof CSSPropertyRule) {
      propertyRules.unshift(rule.cssText);
      sheet.deleteRule(i);
    }
  }
  shadowSheet = sheet;
  shadowCss = Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");

  if (propertyRules.length && !documentStylesInjected) {
    documentStylesInjected = true;
    const documentSheet = new CSSStyleSheet();
    documentSheet.replaceSync(propertyRules.join("\n"));
    if (!adopt(document, documentSheet)) appendStyle(document.head, propertyRules.join("\n"));
  }
}

/** Applies the shared card stylesheet to a shadow root. Never throws. */
export function adoptStyles(root: ShadowRoot): void {
  try {
    prepare();
  } catch (err) {
    console.warn("[camera-plus-card] Failed to prepare styles", err);
    appendStyle(root, css);
    return;
  }
  if (!adopt(root, shadowSheet!)) appendStyle(root, shadowCss!);
}
