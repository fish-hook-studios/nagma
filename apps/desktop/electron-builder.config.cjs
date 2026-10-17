// The build settings in package.json ("build"), plus what depends on the environment: code signing
// and notarisation when their credentials are set, and the update feed the builds publish to.
// Certificates never live in the repo; electron-builder reads them from the environment:
//   macOS:   CSC_LINK (a .p12 path or base64), CSC_KEY_PASSWORD; notarisation with APPLE_ID,
//            APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID (or APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER).
//   Windows: WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD (or CSC_LINK/CSC_KEY_PASSWORD).
// Without them the builds are unsigned. NAGMA_UPDATE_URL makes the builds look for updates there and
// writes the update files (latest-mac.yml, latest.yml) to upload beside them.
const base = require("./package.json").build;
// Settings under the names from before the product's rename still work, as NAGMA_*.
require("./legacy.cjs").adoptLegacyEnv(process.env);

const env = process.env;
const macSigning = Boolean(env.CSC_LINK || env.CSC_NAME);
const winSigning = Boolean(env.WIN_CSC_LINK || env.CSC_LINK);
const notarize = Boolean((env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) || (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER));
// Never pick up whatever signing identity happens to be in this machine's keychain.
if (!macSigning) env.CSC_IDENTITY_AUTO_DISCOVERY = "false";

// The macOS Electron in node_modules is reused for macOS builds; other platforms download theirs.
const otherPlatforms = process.argv.some((a) => /^--(win|windows|linux)$|^-[wl]$/.test(a));
const { electronDist, ...rest } = base;

module.exports = {
    ...rest,
    ...(otherPlatforms ? {} : { electronDist }),
    mac: { ...base.mac, ...(macSigning ? { notarize } : { identity: null, hardenedRuntime: false }) },
    win: { ...base.win, ...(winSigning ? { signtoolOptions: { publisherName: env.WIN_PUBLISHER_NAME || "Nagma", signingHashAlgorithms: ["sha256"] } } : {}) },
    ...(env.NAGMA_UPDATE_URL ? { publish: [{ provider: "generic", url: env.NAGMA_UPDATE_URL, channel: env.NAGMA_UPDATE_CHANNEL || "latest" }] } : { publish: null }),
};
