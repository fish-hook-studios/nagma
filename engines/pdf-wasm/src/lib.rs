//! PdfCraft's page engine for Nagma: open a PDF, draw its pages, organize them (rotate,
//! delete, move, duplicate) with undo, and save it back. `workbench` is the whole editing
//! session behind Document files.

use std::sync::Arc;

pub mod extract;
pub mod workbench;

use pdfcraft_cos::{Document, SaveOptions, write_full, write_incremental};
use pdfcraft_render::{PageRenderer, RenderConfig, RenderRequest, RequestKind};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct PdfDoc {
    cos: Document,
    renderer: PageRenderer,
    /// Parsed for content extraction on first use (and again after an edit).
    parsed: Option<hayro::hayro_syntax::Pdf>,
    undo: Vec<Document>,
    redo: Vec<Document>,
}

fn err(e: impl ToString) -> JsError {
    JsError::new(&e.to_string())
}

#[wasm_bindgen]
impl PdfDoc {
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: Vec<u8>) -> Result<PdfDoc, JsError> {
        let bytes = Arc::new(bytes);
        let cos = Document::open(bytes.clone()).map_err(err)?;
        let renderer = PageRenderer::new(bytes, RenderConfig::default());
        Ok(PdfDoc { cos, renderer, parsed: None, undo: Vec::new(), redo: Vec::new() })
    }

    #[wasm_bindgen(js_name = pageCount)]
    pub fn page_count(&self) -> usize {
        pdfcraft_organize::page_count(&self.cos).unwrap_or(0)
    }

    /// Each page's displayed size in points (crop box, after its rotation) as JSON
    /// `[{width, height, rotation}]`.
    pub fn pages(&self) -> String {
        let boxes = pdfcraft_organize::page_boxes(&self.cos).unwrap_or_default();
        let list: Vec<serde_json::Value> = boxes
            .iter()
            .enumerate()
            .map(|(i, b)| {
                let [x0, y0, x1, y1] = b[1];
                let rotation = pdfcraft_organize::page_rotation(&self.cos, i).unwrap_or(0).rem_euclid(360);
                let (w, h) = ((x1 - x0).abs(), (y1 - y0).abs());
                let (width, height) = if rotation % 180 == 0 { (w, h) } else { (h, w) };
                serde_json::json!({ "width": width, "height": height, "rotation": rotation })
            })
            .collect();
        serde_json::Value::Array(list).to_string()
    }

    /// One page as straight (not premultiplied) RGBA8, `scale` pixels per point. The size is
    /// read back with `lastWidth`/`lastHeight`.
    pub fn render(&mut self, page: usize, scale: f32) -> Result<RenderedImage, JsError> {
        let out = self.renderer.render(RenderRequest { page, kind: RequestKind::Pixels, scale, ..Default::default() });
        if let Some(e) = out.error {
            return Err(err(e));
        }
        let mut rgba: Vec<u8> = out.rgba.to_vec();
        for px in rgba.chunks_exact_mut(4) {
            let a = px[3] as u32;
            if a != 0 && a != 255 {
                for c in &mut px[..3] {
                    *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
                }
            }
        }
        Ok(RenderedImage { width: out.width, height: out.height, rgba })
    }

    /// The text of a page, one line per row.
    pub fn text(&mut self, page: usize) -> String {
        let out = self.renderer.render(RenderRequest { page, kind: RequestKind::Text, scale: 1.0, ..Default::default() });
        out.text.map(|t| t.plain_text()).unwrap_or_default()
    }

    /// A page's content as editable pieces (text runs, paths, images) in page view space, as
    /// JSON plus the images it refers to (see `extract.rs`).
    pub fn content(&mut self, page: usize) -> Result<PageContent, JsError> {
        if self.parsed.is_none() {
            let bytes = self.current_bytes()?;
            self.parsed = Some(hayro::hayro_syntax::Pdf::new(bytes).map_err(|e| err(format!("{e:?}")))?);
        }
        let pdf = self.parsed.as_ref().ok_or_else(|| err("no document"))?;
        let settings = hayro::hayro_interpret::InterpreterSettings::default();
        let (json, images) = extract::extract(pdf, page, &settings).ok_or_else(|| err(format!("no page {page}")))?;
        Ok(PageContent { json, images })
    }

    /// Run an organize command, given as JSON:
    /// `{"op":"rotate","pages":[0],"degrees":90}`, `{"op":"delete","pages":[1]}`,
    /// `{"op":"move","pages":[2],"to":0}`, `{"op":"duplicate","pages":[0]}`,
    /// `{"op":"insertBlank","at":1,"width":612,"height":792}`.
    pub fn execute(&mut self, json: &str) -> Result<(), JsError> {
        let v: serde_json::Value = serde_json::from_str(json).map_err(err)?;
        let pages: Vec<usize> = v["pages"].as_array().map(|a| a.iter().filter_map(|p| p.as_u64().map(|p| p as usize)).collect()).unwrap_or_default();
        let before = self.cos.clone();
        let mut doc = self.cos.clone();
        let res = match v["op"].as_str().unwrap_or("") {
            "rotate" => pdfcraft_organize::rotate_pages(&mut doc, &pages, v["degrees"].as_i64().unwrap_or(90)),
            "delete" => pdfcraft_organize::delete_pages(&mut doc, &pages),
            "move" => pdfcraft_organize::move_pages(&mut doc, &pages, v["to"].as_u64().unwrap_or(0) as usize),
            "duplicate" => pdfcraft_organize::duplicate_pages(&mut doc, &pages),
            "insertBlank" => pdfcraft_organize::insert_blank_page(
                &mut doc,
                v["at"].as_u64().unwrap_or(0) as usize,
                v["width"].as_f64().unwrap_or(612.0),
                v["height"].as_f64().unwrap_or(792.0),
            )
            .map(|_| ()),
            other => return Err(err(format!("unknown command {other}"))),
        };
        res.map_err(err)?;
        self.set(doc)?;
        self.undo.push(before);
        self.redo.clear();
        Ok(())
    }

    pub fn undo(&mut self) -> Result<bool, JsError> {
        let Some(prev) = self.undo.pop() else { return Ok(false) };
        let cur = std::mem::replace(&mut self.cos, prev.clone());
        self.set(prev)?;
        self.redo.push(cur);
        Ok(true)
    }

    pub fn redo(&mut self) -> Result<bool, JsError> {
        let Some(next) = self.redo.pop() else { return Ok(false) };
        let cur = std::mem::replace(&mut self.cos, next.clone());
        self.set(next)?;
        self.undo.push(cur);
        Ok(true)
    }

    /// The document as PDF bytes: an incremental update of the original, or a compact rewrite.
    pub fn save(&self, full: bool) -> Result<Vec<u8>, JsError> {
        if !full && !self.cos.is_modified() {
            return Ok(self.cos.bytes().to_vec());
        }
        let opts = SaveOptions::default();
        if full { write_full(&self.cos, &opts) } else { write_incremental(&self.cos, &opts) }.map_err(err)
    }
}

impl PdfDoc {
    fn current_bytes(&self) -> Result<Arc<Vec<u8>>, JsError> {
        Ok(if self.cos.is_modified() { Arc::new(write_incremental(&self.cos, &SaveOptions::default()).map_err(err)?) } else { self.cos.bytes().clone() })
    }

    /// Make `doc` current and point the renderer at its bytes.
    fn set(&mut self, doc: Document) -> Result<(), JsError> {
        let bytes = if doc.is_modified() {
            Arc::new(write_incremental(&doc, &SaveOptions::default()).map_err(err)?)
        } else {
            doc.bytes().clone()
        };
        self.renderer = PageRenderer::new(bytes, RenderConfig::default());
        self.parsed = None;
        self.cos = doc;
        Ok(())
    }
}

#[wasm_bindgen]
pub struct RenderedImage {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

#[wasm_bindgen]
impl RenderedImage {
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }
    #[wasm_bindgen(getter)]
    pub fn rgba(&self) -> Vec<u8> {
        self.rgba.clone()
    }
}

#[wasm_bindgen]
pub struct PageContent {
    json: String,
    images: Vec<extract::Rgba>,
}

#[wasm_bindgen]
impl PageContent {
    #[wasm_bindgen(getter)]
    pub fn json(&self) -> String {
        self.json.clone()
    }
    /// Image `index` as straight RGBA8.
    pub fn image(&self, index: usize) -> Option<RenderedImage> {
        let img = self.images.get(index)?;
        Some(RenderedImage { width: img.width, height: img.height, rgba: img.data.clone() })
    }
}
