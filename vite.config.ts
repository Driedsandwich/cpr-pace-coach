import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => {
  // MediaPipe 1.2.2 attempts SDK telemetry without a public opt-out. Enforce
  // the privacy boundary at the browser, including dependency-owned requests.
  const dev = command === "serve";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval'${dev ? " 'unsafe-inline'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self' https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task${dev ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");
  return {
    base: "/cpr-pace-coach/",
    plugins: [
      react(),
      {
        name: "on-device-privacy-policy",
        transformIndexHtml() {
          return [
            {
              tag: "meta",
              attrs: {
                "http-equiv": "Content-Security-Policy",
                content: policy,
              },
              injectTo: "head-prepend",
            },
          ];
        },
      },
    ],
    build: { outDir: "dist/site", emptyOutDir: true },
  };
});
