import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import { onlookReactBridge } from '@onlook-next/react-live-bridge';

export default defineConfig({
  plugins: [onlookReactBridge(), react()],
  server: {
    port: 5180,
  },
});
