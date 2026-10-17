#!/bin/sh
# Builds DesignCraft's engine for the browser and writes it into the editor (apps/web/src/engines/layout).
# Needs: Rust (rustup, wasm32-unknown-unknown target), wasm-bindgen-cli matching Cargo.lock, binaryen.
set -e
cd "$(dirname "$0")/layout-wasm"
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"
cargo build --release --target wasm32-unknown-unknown
OUT=../../apps/web/src/engines/layout
wasm-bindgen target/wasm32-unknown-unknown/release/nagma_layout.wasm --out-dir "$OUT" --target web --typescript
wasm-opt -O3 --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals --enable-reference-types --enable-multivalue \
    "$OUT/nagma_layout_bg.wasm" -o "$OUT/nagma_layout_bg.wasm"
echo "DesignCraft engine built: $(du -h "$OUT/nagma_layout_bg.wasm" | cut -f1)"
