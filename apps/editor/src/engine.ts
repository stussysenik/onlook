let frameworkEnginePromise: Promise<typeof import('@onlook-next/framework-engine')> | null = null;

export function loadFrameworkEngine() {
  if (!frameworkEnginePromise) {
    frameworkEnginePromise = import('@onlook-next/framework-engine').then(async (frameworkEngine) => {
      const enableAccelerator = import.meta.env.VITE_ENABLE_ZIG_ACCELERATOR === 'true';
      frameworkEngine.configureAccelerator({ enabled: enableAccelerator });

      if (enableAccelerator) {
        await frameworkEngine.warmAccelerator();
      }

      return frameworkEngine;
    });
  }

  return frameworkEnginePromise;
}
