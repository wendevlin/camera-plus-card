import { CameraPlusCard } from "./card/camera-plus-card.svelte";
import { CARD_TYPE } from "./card/config";

if (!customElements.get(CARD_TYPE)) {
  customElements.define(CARD_TYPE, CameraPlusCard);

  window.customCards ??= [];
  window.customCards.push({
    type: CARD_TYPE,
    name: "Camera Plus",
    description: "Live camera with WebRTC, digital zoom, press-and-hold PTZ and a door button.",
    preview: false,
    // Offered in the card picker when a camera entity is selected. The card is
    // configured by device, so suggest the entity's device.
    getEntitySuggestion: (hass, entityId) => {
      const deviceId = hass.entities?.[entityId]?.device_id;
      if (!entityId.startsWith("camera.") || !deviceId) return null;
      return { label: "Camera Plus", config: { type: `custom:${CARD_TYPE}`, device_id: deviceId } };
    },
  });

  console.info(
    `%c CAMERA-PLUS-CARD %c ${__CARD_VERSION__} `,
    "color: white; background: #1565c0; font-weight: 700;",
    "color: #1565c0; background: white; font-weight: 700;",
  );
}
