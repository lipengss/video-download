import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";

/** 将实际端口写入文件，供 Electron 主进程读取 */
function portFilePlugin(): Plugin {
  const PORT_FILE = path.resolve(__dirname, ".vite-port");
  return {
    name: "write-port-file",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        const addr = server.httpServer!.address();
        const port = typeof addr === "object" && addr ? addr.port : 5173;
        fs.writeFileSync(PORT_FILE, String(port));
        console.log(`  [electron] port written to .vite-port: ${port}`);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), portFilePlugin()],
  root: path.resolve(__dirname, "src"),
  base: "./",
  build: {
    outDir: path.resolve(__dirname, "dist-renderer"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
