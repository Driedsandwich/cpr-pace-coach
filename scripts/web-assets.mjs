import { cp, mkdir } from "node:fs/promises";
// WASM ships with the pinned npm SDK; model weights are fetched at runtime only.
await mkdir("public/vendor/mediapipe", { recursive: true });
await cp(
  "node_modules/@mediapipe/tasks-vision/wasm",
  "public/vendor/mediapipe/wasm",
  { recursive: true },
);
await cp("schema", "public/schema", { recursive: true });
