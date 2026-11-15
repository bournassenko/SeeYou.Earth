import solid from "@astrojs/solid-js";
import { defineConfig } from "astro/config";

export default defineConfig({
  integrations: [solid()],
  vite: {
    server: {
      proxy: { "/api": "http://127.0.0.1:4323" },
    },
  },
  devToolbar: { enabled: false },
});
