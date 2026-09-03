import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { createApiRouter } from "./server/api.js";

// Mode dev: path lokal diizinkan bebas (kecuali LR_RESULTS_ROOT diset),
// karena dev server default-nya hanya mendengar di 127.0.0.1.
const handleApi = createApiRouter({ pathMode: true });

function apiMiddleware(server) {
  server.middlewares.use(async (req, res, next) => {
    if (!(await handleApi(req, res))) next();
  });
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    {
      name: "loadrunner-api",
      configureServer: apiMiddleware,
      configurePreviewServer: apiMiddleware,
    },
  ],
  server: {
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT) || 8787,
    watch: {
      ignored: ["**/.loadrunner-cache/**"],
    },
  },
  build: {
    rollupOptions: {
      input: {
        app: "index.html",
      },
    },
  },
});
