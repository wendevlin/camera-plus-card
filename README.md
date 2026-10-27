# Camera Plus Card

A Home Assistant dashboard card for any camera. It looks like the regular picture card, but tapping it opens a richer live view:

- **WebRTC first.** It falls back to HLS, then MJPEG. A badge shows which one is active.
- **Large centered dialog** on desktop and mobile, sized to the camera's aspect ratio. On narrow portrait screens the PTZ controls sit below the video instead of on top of it.
- **Custom video controls:** mute, stream quality switch, snapshot download, digital zoom, picture-in-picture and fullscreen.
- **Digital zoom.** Pinch to zoom on touch devices. On desktop, use the zoom button's slider or ctrl/⌘ + scroll. Drag to look around while zoomed, and double-tap or double-click to toggle 2×.
- **Door button.** Pick a lock, button or switch, and the live view gets a door button with a confirmation step. Works with any camera, e.g. a DoorBird relay.
- **Press-and-hold PTZ** for supported cameras (currently Reolink). The camera moves while you hold an arrow and stops when you let go. Stop is also sent when your pointer slides off the button, the window loses focus, the tab is hidden, and after 30 s as a safety net. Optical zoom uses big **+ / −** buttons, and presets are in a dropdown. Arrow keys and +/− work too.

## Install

Requires **Home Assistant 2026.5** or newer. The card reads its data from the frontend's context API, which arrived in that release.

> **Beta:** 0.1.0 is published as a GitHub pre-release. If HACS only offers the default branch, choose the beta version in its download dialog.

### HACS (custom repository)

1. Open HACS, then *⋮ → Custom repositories*.
2. Add `https://github.com/wendevlin/camera-plus-card` with type **Dashboard**.
3. Open **Camera Plus Card** and download it.
4. Reload the browser. HACS registers the resource for you.

### Manual

Download every `.js` file from the [latest release](https://github.com/wendevlin/camera-plus-card/releases) into `/config/www/camera-plus-card/`. The card loads hls.js from a second file, and only when WebRTC isn't available. Then add `/local/camera-plus-card/camera-plus-card.js` as a **JavaScript module** under *Settings → Dashboards → ⋮ → Resources*.

## Configure

Add the card from the card picker (**Camera Plus**). The editor uses HA's own form with a device picker that lists every device with a camera entity.

```yaml
type: custom:camera-plus-card
device_id: 0123456789abcdef0123456789abcdef
name: Garden              # optional, defaults to the device name
door_entity: button.front_door_relay_1   # optional lock, button or switch
show_ptz: true            # pan & tilt, if supported
show_optical_zoom: true   # optical zoom, if supported
ptz_speed: 20             # optional 1–64, if the camera supports a speed
stream: auto              # auto | main | sub | ext, for cameras with several streams
show_name: true
```

The door button calls `lock.unlock`, `button.press` or `switch.turn_on`, depending on the entity.

## Camera support

Every camera gets the live view, digital zoom, snapshots and the door button. PTZ and stream switching need vendor knowledge, which lives in small profiles in `src/lib/camera/profiles/`:

| Integration | Streams | PTZ |
| --- | --- | --- |
| Reolink | `sub` (Fluent), `main` (Clear), `ext` (Balanced) | Press-and-hold moves, optical zoom, presets, speed |

PTZ and optical zoom only show when the camera supports them **and their entities are enabled**. Disabled entities are invisible to the card.

### Reolink: enable the PTZ entities you need

Reolink disables some PTZ entities by default. Enable them on the device page:

| Entity | Needed for |
| --- | --- |
| **PTZ stop** | Stopping moves. Without it, moves can't be stopped. |
| **PTZ zoom in / zoom out** | Smooth optical zoom. Without them, +/− steps the *Zoom* number entity instead. |
| **PTZ left up / right down / …** | The diagonal buttons. |

### Adding a profile

A profile maps a device's entities of one integration (matched by entity registry `platform` and `translation_key`) to stream variants and PTZ controls. See `src/lib/camera/profiles/reolink.ts` and register it in `src/lib/camera/profiles/index.ts`. Moves are expected to be continuous until a stop button is pressed.

## Development

The toolchain is [Bun](https://bun.sh) (pinned in `mise.toml`), with Vite as the bundler. Linting and formatting use [Biome](https://biomejs.dev).

| Command | What it does |
| --- | --- |
| `bun run dev` | Rebuild `dist/` on change (unminified, with sourcemaps) |
| `bun run preview` | Serve `dist/` on `:5173` with CORS; add `http://<your-ip>:5173/camera-plus-card.js` as a resource |
| `bun run build` | Production bundle `dist/camera-plus-card.js` |
| `bun run lint` / `bun run format` | Biome check / fix |
| `bun run check` | `svelte-check` type checking |
| `bun test` | Unit tests |
| `bun run ci` | All of the above |

### Releasing

1. Bump `version` in `package.json` (e.g. `0.1.0-beta.2`) and commit.
2. Create a GitHub release whose tag is exactly the version, without a `v` prefix (e.g. `0.1.0-beta.1`). Mark betas as *pre-release*.
3. The release workflow checks the tag against `package.json`, runs all checks, builds and attaches the `.js` files, then runs the HACS validation against the release. HACS picks the files up from there.

### How it fits into Home Assistant

- **Svelte 5 in a shadow root.** `src/card/camera-plus-card.svelte.ts` is a thin custom element that HA talks to (`setConfig`, `getConfigForm`, `getGridOptions`). It mounts the Svelte app into its open shadow root. It uses no HA components, so nothing leaks in or out.
- **HA contexts instead of `hass`.** The element dispatches the standard `context-request` event, the same protocol `@lit/context` uses. It reads `states`, `entities`, `devices`, `hassApi`, `hassConnection` and others from the providers on `<home-assistant>`. See `src/lib/ha/context.svelte.ts`.
- **Bundle.** One ES module plus a lazily loaded hls.js chunk, resolved relative to the card file. Clients that get WebRTC (the default with go2rtc) never download it.
- **Styles.** Tailwind v4 and shadcn-svelte are compiled to a single constructable stylesheet that's adopted by the shadow root (`src/lib/shadow.ts`), with a `<style>` fallback. `@property` rules don't work inside shadow roots, so they're moved to the document once. Design tokens map to HA theme variables (`--primary-color`, `--card-background-color`, and so on), so the card follows the active theme.
- **Dialog.** It's a native `<dialog>` opened with `showModal()`, rendered inside the card. The browser's top layer means parent cards can't clip it, even inside sections or stacks. Popovers and selects portal into the dialog through `BitsConfig defaultPortalTo`, never into `document.body`.
- **Camera mapping** (`src/lib/camera/device.ts`). Collects the device's camera entities for any integration, then applies the profile of each integration present.
