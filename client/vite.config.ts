import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

export default defineConfig(({ command }) => ({
  plugins: [
    tsConfigPaths(),
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    tanstackStart({ server: { entry: "server" } }),
    viteReact(),
    tailwindcss(),
    // nitro builds the server output; not needed in dev
    ...(command === "build" ? [nitro()] : []),
  ],
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-start"],
  },
  // Pre-bundle shell deps so Vite doesn't re-optimize mid-load (which loads a second React copy).
  optimizeDeps: {
    include: ["@radix-ui/react-dialog", "clsx", "lucide-react", "tailwind-merge"],
  },
}));
