import type { EntityRegistryDisplayEntry } from "../../ha/types";
import type { CameraDevice } from "../types";
import { reolink } from "./reolink";

/**
 * Vendor knowledge the generic resolver can't infer: which camera entities
 * are stream variants of each other and which entities drive PTZ.
 */
export interface CameraProfile {
  /** Fills in streams and PTZ from the device's entities of this integration. */
  resolve(entries: EntityRegistryDisplayEntry[], device: CameraDevice): void;
}

/** Profiles keyed by integration (entity registry `platform`). */
export const PROFILES: Record<string, CameraProfile> = {
  reolink,
};
