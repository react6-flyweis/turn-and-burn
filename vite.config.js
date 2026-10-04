import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" lets the built site run from any folder (including opening dist/ on a static host)
export default defineConfig({
  base: "./",
  plugins: [react()],
});
