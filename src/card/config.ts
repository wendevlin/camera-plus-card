import { DOOR_DOMAINS } from "../lib/door";
import type { HaFormSchema, LovelaceConfigForm } from "../lib/ha/types";
import { createTranslate, type TranslationKey } from "../lib/i18n";

export const CARD_TYPE = "camera-plus-card";

export type StreamPreference = "auto" | "main" | "sub" | "ext";

export interface CameraPlusCardConfig {
  type: string;
  device_id?: string;
  name?: string;
  stream?: StreamPreference;
  show_ptz?: boolean;
  show_optical_zoom?: boolean;
  ptz_speed?: number;
  door_entity?: string;
  show_name?: boolean;
}

export type ResolvedConfig = Required<
  Pick<CameraPlusCardConfig, "stream" | "show_name" | "show_ptz" | "show_optical_zoom">
> &
  CameraPlusCardConfig;

export const resolveConfig = (config: CameraPlusCardConfig): ResolvedConfig => ({
  ...config,
  stream: config.stream ?? "auto",
  show_ptz: config.show_ptz ?? true,
  show_optical_zoom: config.show_optical_zoom ?? true,
  show_name: config.show_name ?? true,
});

const selectOptions = (values: string[]) => values.map((value) => ({ value, label: value }));

const SCHEMA: HaFormSchema[] = [
  {
    name: "device_id",
    required: true,
    // Any device that has a camera entity, whatever the integration.
    selector: { device: { entity: { domain: "camera" } } },
  },
  { name: "name", selector: { text: {} } },
  {
    name: "door_entity",
    selector: { entity: { filter: { domain: DOOR_DOMAINS } } },
  },
  {
    name: "",
    type: "expandable",
    title: "Controls",
    icon: "mdi:tune",
    schema: [
      { name: "show_ptz", default: true, selector: { boolean: {} } },
      { name: "show_optical_zoom", default: true, selector: { boolean: {} } },
      {
        name: "ptz_speed",
        selector: { number: { min: 1, max: 64, step: 1, mode: "slider" } },
      },
      {
        name: "stream",
        default: "auto",
        selector: {
          select: { mode: "dropdown", options: selectOptions(["auto", "main", "sub", "ext"]) },
        },
      },
      { name: "show_name", default: true, selector: { boolean: {} } },
    ],
  },
];

/**
 * Editor form rendered by HA's own `ha-form`. `getConfigForm` is static and
 * gets no context, so the language comes from `<html lang>`, which HA keeps in
 * sync with the user's profile language (the browser language is only a fallback).
 */
export function getConfigForm(): LovelaceConfigForm {
  const t = createTranslate(document.documentElement.lang || navigator.language);
  // `select` option labels can't be localized after the fact, so patch them in.
  const schema = structuredClone(SCHEMA);
  const localize = (items: HaFormSchema[]) => {
    for (const item of items) {
      if (item.schema) localize(item.schema);
      if (item.type === "expandable") item.title = t("editor.controls");
      const select = item.selector?.select as { options?: { value: string; label: string }[] } | undefined;
      for (const option of select?.options ?? []) {
        option.label = t(`editor.${item.name}.${option.value}` as TranslationKey);
      }
    }
  };
  localize(schema);

  return {
    schema,
    assertConfig: (config) => {
      if (config.device_id !== undefined && typeof config.device_id !== "string") {
        throw new Error("device_id must be a string");
      }
    },
    computeLabel: (item) => (item.name ? t(`editor.${item.name}` as TranslationKey) : undefined),
    computeHelper: (item) => {
      const key = `editor.${item.name}.helper` as TranslationKey;
      const text = t(key);
      return text === key ? undefined : text;
    },
  };
}
