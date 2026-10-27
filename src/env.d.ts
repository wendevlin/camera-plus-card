/// <reference types="vite/client" />

declare const __CARD_VERSION__: string;

// hls.js ships no typings for its light build; it shares the full build's API.
declare module "hls.js/light" {
  export { default } from "hls.js";
}
