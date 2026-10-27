import de from "./de.json";
import en from "./en.json";

export type TranslationKey = keyof typeof en;

const translations: Record<string, Partial<Record<TranslationKey, string>>> = { en, de };

export type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/** Returns a translate function for an HA language code like `de` or `en-GB`. */
export function createTranslate(language: string): Translate {
  const dict = translations[language] ?? translations[language.split("-")[0]] ?? en;
  return (key, vars) => {
    let text = dict[key] ?? en[key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  };
}
