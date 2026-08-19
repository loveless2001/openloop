import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, "../../", "");
  const serverPort = Number(environment.SERVER_PORT || 8787);
  const webPort = Number(environment.WEB_PORT || 5173);

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: webPort,
      proxy: {
        "/v1": `http://127.0.0.1:${serverPort}`,
      },
    },
  };
});
