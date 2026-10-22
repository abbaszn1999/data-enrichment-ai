import { startServer } from "./server";

process.on("uncaughtException", (error) => {
  console.error("[assistant] uncaught exception:", error);
});
process.on("unhandledRejection", (reason) => {
  console.error("[assistant] unhandled rejection:", reason);
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
  process.on(signal, () => {
    console.error(`[assistant] received ${signal}, exiting`);
    process.exit(0);
  });
}
process.on("exit", (code) => {
  console.error(`[assistant] process exit code=${code}`);
});

startServer().catch((error) => {
  console.error("[assistant] failed to start:", error);
  process.exit(1);
});
