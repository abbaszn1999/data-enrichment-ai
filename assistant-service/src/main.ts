import { installDnsCache } from "./dns-cache";
import { startServer } from "./server";

installDnsCache();

process.on("uncaughtException", (error) => {
  console.error("[assistant] uncaught exception:", error);
});
process.on("unhandledRejection", (reason) => {
  console.error("[assistant] unhandled rejection:", reason);
});
process.on("exit", (code) => {
  console.error(`[assistant] process exit code=${code}`);
});

startServer()
  .then(({ server, shutdown }) => {
    let stopping = false;
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
      process.on(signal, () => {
        if (stopping) process.exit(0);
        stopping = true;
        console.error(`[assistant] received ${signal}, stopping live runs`);
        // A deploy sends SIGTERM: stop Store Agent runs as "interrupted", save them, then exit.
        server.close();
        void shutdown()
          .catch((error) => console.error("[assistant] shutdown failed:", error))
          .finally(() => process.exit(0));
      });
    }
  })
  .catch((error) => {
    console.error("[assistant] failed to start:", error);
    process.exit(1);
  });
