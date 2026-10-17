// The build settings in package.json ("build"), plus what depends on the environment: code signing
// and notarisation when their credentials are set, and the update feed the builds publish to.
// Certificates never live in the repo; electron-builder reads them from the environment:
//   macOS:   CSC_LINK (a .p12 path or base64), CSC_KEY_PASSWORD; notarisation with APPLE_ID,
//            APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID (or APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER).
//   Windows: WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD (or CSC_LINK/CSC_KEY_PASSWORD).
// Without them the builds are unsigned.
//
// Updates (update-feed.cjs): by default the builds update from the project's GitHub Releases, and
// electron-builder writes the update files (latest-mac.yml, latest.yml, latest-linux.yml) that the
// release workflow uploads beside the installers. NAGMA_UPDATE_URL points them at a folder of your own
// instead (generic provider); NAGMA_NO_UPDATES=1 makes a build that never updates itself.
// Each build carries build-flags.json in its resources: whether it was signed (macOS installs
// updates only into signed builds; an unsigned Mac build links to the release page instead) and
// whether updates are off.
const fs = require("node:fs");
const path = require("node:path");
const feeds = require("./update-feed.cjs");
const base = require("./package.json").build;
// Settings under the names from before the product's rename still work, as NAGMA_*.
require("./legacy.cjs").adoptLegacyEnv(process.env);

const env = process.env;
const macSigning = Boolean(env.CSC_LINK || env.CSC_NAME);
const winSigning = Boolean(env.WIN_CSC_LINK || env.CSC_LINK);
const notarize = Boolean((env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) || (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER));
// Never pick up whatever signing identity happens to be in this machine's keychain.
if (!macSigning) env.CSC_IDENTITY_AUTO_DISCOVERY = "false";

// The macOS Electron in node_modules is reused for macOS builds of this Mac's own architecture
// (an arch flag naming only it, or --dir); other platforms and architectures download theirs.
const argv = process.argv;
const otherPlatforms = argv.some((a) => /^--(win|windows|linux)$|^-[wl]$/.test(a));
const archFlags = ["x64", "arm64", "ia32", "armv7l", "universal"].filter((a) => argv.includes(`--${a}`));
const hostArchOnly = archFlags.length ? archFlags.every((a) => a === process.arch) : argv.includes("--dir");
const { electronDist, ...rest } = base;
const flags = feeds.buildFlags({ env, macSigned: macSigning, winSigned: winSigning });

// Writes build-flags.json into the packed app's resources (before signing, so it is sealed too).
async function afterPack(context) {
    const resources = context.electronPlatformName === "darwin" ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources") : path.join(context.appOutDir, "resources");
    fs.writeFileSync(path.join(resources, feeds.FLAGS_FILE), `${JSON.stringify(flags, null, 2)}\n`);
}

module.exports = {
    ...rest,
    ...(otherPlatforms || !hostArchOnly ? {} : { electronDist }),
    afterPack,
    mac: { ...base.mac, ...(macSigning ? { notarize } : { identity: null, hardenedRuntime: false }) },
    win: { ...base.win, ...(winSigning ? { signtoolOptions: { publisherName: env.WIN_PUBLISHER_NAME || "Nagma", signingHashAlgorithms: ["sha256"] } } : {}) },
    publish: feeds.publishConfig(env),
};
