export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installProviderNameScrubber } = await import("./lib/provider-names-response");
    installProviderNameScrubber();
  }
  const { initSentry } = await import("./lib/observability/sentry-init");
  await initSentry();
}
