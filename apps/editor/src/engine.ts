let frameworkEnginePromise: Promise<typeof import('@onlook-next/framework-engine')> | null = null;

export function loadFrameworkEngine() {
  if (!frameworkEnginePromise) {
    frameworkEnginePromise = import('@onlook-next/framework-engine');
  }

  return frameworkEnginePromise;
}
