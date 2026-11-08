import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.worldradio.translator',
  appName: 'World Radio Translator',
  webDir: 'dist',
  // Use HTTPS scheme in WebView; allow cleartext for http backends if needed.
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
};

export default config;
