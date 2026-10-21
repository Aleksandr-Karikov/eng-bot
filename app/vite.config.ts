import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Бот отдаёт собранное приложение по адресу /app/ (src/app/server.ts).
export default defineConfig({ base: "/app/", plugins: [react()], build: { outDir: "dist", emptyOutDir: true } });
