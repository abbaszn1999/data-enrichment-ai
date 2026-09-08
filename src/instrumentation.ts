export async function register() {
  const { initSentry } = await import("./lib/observability/sentry-init");
  await initSentry();
}
