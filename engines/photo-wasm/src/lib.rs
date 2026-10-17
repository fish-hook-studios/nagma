//! A thin JavaScript bridge to PhotoCraft's engine, so Nagma can open photos and PSD files,
//! run PhotoCraft's commands on them (adjustments, filters, layer edits…) and draw the result.
//! Everything goes through PhotoCraft's own command entry point, `Session::execute`, the same way
//! its app, CLI and agent interfaces do.

use photocraft_engine::Session;
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

fn js_err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

#[wasm_bindgen]
pub struct PhotoDoc {
    session: Session,
}

#[wasm_bindgen]
impl PhotoDoc {
    /// Opens image or document bytes (PNG, JPEG, WebP, TIFF, PSD, …) as a new photo document.
    #[wasm_bindgen(constructor)]
    pub fn new(name: &str, bytes: &[u8]) -> Result<PhotoDoc, JsError> {
        let imported = photocraft_io::import(name, bytes).map_err(js_err)?;
        let mut session = Session::new();
        session.open_document(imported.document, None);
        Ok(PhotoDoc { session })
    }

    fn doc(&self) -> Result<&photocraft_doc::Document, JsError> {
        self.session.active().map(|state| &*state.doc).ok_or_else(|| JsError::new("no document"))
    }

    pub fn width(&self) -> u32 {
        self.doc().map(|d| d.bounds().width() as u32).unwrap_or(0)
    }

    pub fn height(&self) -> u32 {
        self.doc().map(|d| d.bounds().height() as u32).unwrap_or(0)
    }

    /// The flattened image as 8-bit straight RGBA, row by row (width × height × 4 bytes).
    pub fn render(&self) -> Result<Vec<u8>, JsError> {
        let doc = self.doc()?;
        let buffer = photocraft_compose::flatten(doc);
        let mut out = Vec::with_capacity(buffer.px.len() * 4);
        for px in &buffer.px {
            for channel in px {
                out.push((channel.clamp(0.0, 1.0) * 255.0 + 0.5) as u8);
            }
        }
        Ok(out)
    }

    /// Runs a PhotoCraft command by id with JSON parameters; returns its JSON result.
    pub fn execute(&mut self, id: &str, params: &str) -> Result<String, JsError> {
        let params: Value = if params.trim().is_empty() { json!({}) } else { serde_json::from_str(params).map_err(js_err)? };
        let result = self.session.execute(id, params).map_err(js_err)?;
        Ok(result.to_string())
    }

    pub fn undo(&mut self) -> bool {
        self.session.undo()
    }

    pub fn redo(&mut self) -> bool {
        self.session.redo()
    }

    /// Saves to a format chosen by name or extension: "png", "jpg", "webp", "tiff", "psd", …
    pub fn export(&self, name_or_ext: &str) -> Result<Vec<u8>, JsError> {
        let doc = self.doc()?;
        let result = photocraft_io::export(doc, name_or_ext, &photocraft_io::ExportOptions::default()).map_err(js_err)?;
        Ok(result.bytes)
    }

    /// The layer tree, top first: id, name, kind, visibility, opacity, depth, and which is active.
    pub fn layers(&self) -> Result<String, JsError> {
        let doc = self.doc()?;
        let active = self.session.active().and_then(|state| state.active_layer);
        let mut list: Vec<Value> = doc
            .walk()
            .into_iter()
            .map(|(_, depth, layer)| {
                json!({
                    // The id as PhotoCraft's commands expect it (e.g. for "layer.select").
                    "id": serde_json::to_value(layer.id).unwrap_or(Value::Null),
                    "active": active == Some(layer.id),
                    "name": layer.name,
                    "kind": layer.content.kind_name(),
                    "visible": layer.visible,
                    "opacity": layer.opacity,
                    "depth": depth,
                })
            })
            .collect();
        list.reverse();
        Ok(Value::Array(list).to_string())
    }
}

/// Every PhotoCraft command: id, label, menu path, shortcut and parameter description.
#[wasm_bindgen]
pub fn commands() -> String {
    let specs: Vec<Value> = photocraft_engine::commands::command_specs()
        .iter()
        .map(|spec| json!({ "id": spec.id, "label": spec.label, "menu": spec.menu, "shortcut": spec.shortcut, "params": spec.params }))
        .collect();
    Value::Array(specs).to_string()
}
