// Files the app is asked to open from Finder, the Dock icon or the command line (main.cjs): which
// ones Nagma imports, and reading one to hand to the editor (window.__nagmaMenu("openFig")), which
// imports it as a new file the way Import… does (apps/web/src/engine/images.ts, IMPORT_ACCEPT).

const path = require("node:path");

// Everything Import… opens: design, slides and campaign files, presentations, PDFs, page layouts,
// Sketch and Photoshop files, pictures and video.
const OPENABLE = /\.(fig|deck|buzz|pptx|pdf|sketch|idml|designcraft|psd|psb|svg|png|jpe?g|gif|webp|avif|bmp|tiff?|mp4|m4v|mov|mkv|webm|mxf)$/i;

// The file goes to the page as base64 through executeJavaScript, about a third bigger again;
// past this it's refused with a message (Import… in the app reads bigger files directly).
const MAX_OPEN_BYTES = 256 * 1024 * 1024;

// The paths among command-line arguments or opened files that Nagma can import (flags and the
// app's own path aren't files to open).
function openableFiles(args) {
    return args.filter((a) => typeof a === "string" && !a.startsWith("-") && OPENABLE.test(a));
}

// Reads a file for the editor, or throws a message to show when it can't be.
function readOpenFile(fs, file) {
    const name = path.basename(file);
    const size = fs.statSync(file).size;
    if (size > MAX_OPEN_BYTES) throw new Error(`${name} is larger than ${MAX_OPEN_BYTES / 1024 / 1024} MB. Open it with Import… in Nagma instead.`);
    return { name, data: fs.readFileSync(file).toString("base64") };
}

module.exports = { OPENABLE, MAX_OPEN_BYTES, openableFiles, readOpenFile };
