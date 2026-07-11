import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/jetlag-sf-hide-seek/",
  plugins: [react()],
});
