import type { CapacitorConfig } from "@capacitor/cli";

// Native iOS/Android shell for Knit. The app loads the live knit.gatheredin.app
// site via server.url (it relies on its serverless api/ routes), with native
// plugins (splash) for real native value to pass Apple review guideline 4.2.
// Mirror of the Homefront/Steward pattern.
const config: CapacitorConfig = {
  appId: "app.gatheredin.knit",
  appName: "Knit",
  webDir: "public",
  server: {
    url: "https://knit.gatheredin.app",
    cleartext: false,
  },
  ios: {
    backgroundColor: "#FFFFFF",
  },
};

export default config;
