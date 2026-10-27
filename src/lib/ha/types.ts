/**
 * Minimal subset of Home Assistant frontend types we depend on.
 * Mirrors `frontend/src/types.ts` and the registry data files.
 */

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown> & {
    friendly_name?: string;
    supported_features?: number;
    access_token?: string;
    entity_picture?: string;
    options?: string[];
    min?: number;
    max?: number;
    step?: number;
  };
  last_changed: string;
  last_updated: string;
}

export type HassEntities = Record<string, HassEntity>;

export interface EntityRegistryDisplayEntry {
  entity_id: string;
  name?: string;
  device_id?: string;
  area_id?: string;
  hidden?: boolean;
  entity_category?: "config" | "diagnostic";
  translation_key?: string;
  platform?: string;
}

export interface DeviceRegistryEntry {
  id: string;
  name: string | null;
  name_by_user: string | null;
  manufacturer: string | null;
  model: string | null;
  via_device_id: string | null;
  parent_device_id?: string | null;
  config_entries: string[];
}

export interface MessageBase {
  type: string;
  [key: string]: unknown;
}

export interface HassConnection {
  subscribeMessage<T>(
    callback: (message: T) => void,
    subscribeMessage: MessageBase,
    options?: { resubscribe?: boolean },
  ): Promise<() => Promise<void>>;
}

/** Value of the `hassApi` context. */
export interface HassApi {
  callWS<T>(msg: MessageBase): Promise<T>;
  callService(
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: { entity_id?: string | string[] },
  ): Promise<unknown>;
  callApiRaw(method: "GET" | "POST", path: string): Promise<Response>;
}

/** Value of the `hassConnection` context. */
export interface HassConnectionContext {
  connection: HassConnection;
  connected: boolean;
  hassUrl(path?: string): string;
}

/** Value of the `hassInternationalization` context. */
export interface HassInternationalization {
  language: string;
}

/** Value of the `hassUi` context. */
export interface HassUi {
  themes: { darkMode: boolean };
}

/** Context keys provided by `<home-assistant>` (see `frontend/src/data/context/index.ts`). */
export interface HassContexts {
  states: HassEntities;
  entities: Record<string, EntityRegistryDisplayEntry>;
  devices: Record<string, DeviceRegistryEntry>;
  hassApi: HassApi;
  hassConnection: HassConnectionContext;
  hassInternationalization: HassInternationalization;
  hassUi: HassUi;
  narrowViewport: boolean;
  reducedMotion: boolean;
}

/** The legacy `hass` object, only used where HA gives us nothing else (`getStubConfig`). */
export interface HomeAssistant {
  states: HassEntities;
  entities: Record<string, EntityRegistryDisplayEntry>;
  devices: Record<string, DeviceRegistryEntry>;
}

export interface LovelaceGridOptions {
  columns?: number | "full";
  rows?: number | "auto";
  min_columns?: number;
  max_columns?: number;
  min_rows?: number;
  max_rows?: number;
}

export interface HaFormSchema {
  name: string;
  required?: boolean;
  default?: unknown;
  selector?: Record<string, unknown>;
  type?: "grid" | "expandable";
  schema?: HaFormSchema[];
  title?: string;
  icon?: string;
}

export interface LovelaceConfigForm {
  schema: HaFormSchema[];
  assertConfig?: (config: Record<string, unknown>) => void;
  computeLabel?: (schema: HaFormSchema) => string | undefined;
  computeHelper?: (schema: HaFormSchema) => string | undefined;
}

declare global {
  interface Window {
    customCards?: {
      type: string;
      name?: string;
      description?: string;
      preview?: boolean;
      documentationURL?: string;
      getEntitySuggestion?: (
        hass: HomeAssistant,
        entityId: string,
      ) => { label?: string; config: Record<string, unknown> } | null;
    }[];
  }
}
