//! The Document workbench: a whole PdfCraft editing session for Nagma's Document files. Pages,
//! comments and markup, Fill & Sign, form filling, redaction, password protection, editing
//! existing text and images, organizing, optimizing and saving, all through PdfCraft's engine.
//!
//! Geometry crosses the boundary in page *view space*: points, origin at the top-left of the
//! page as displayed (after `/Rotate`), y down; the same space the text layer uses. It is turned
//! into PDF user space here, per page.

use std::sync::Arc;

use pdfcraft_engine::{
    AddedText, Changes, DocId, Edit, FieldValue, FillMark, FormFieldKind, ImageEdit, LineEnding, MarkFile, Markup, NewAnnotation, NoteIcon, OverlayLook,
    Printing, Protection, Session, Shape, StampKind, Style, field_flags,
};
use pdfcraft_render::{OutlineItem, PageInfo, RenderRequest, RequestKind};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

use crate::RenderedImage;

#[wasm_bindgen(inline_js = "export function local_now() { const d = new Date(); return d.getTime() / 1000 - d.getTimezoneOffset() * 60; }")]
extern "C" {
    fn local_now() -> f64;
}

/// The session clock: the browser's local time (the engine stamps comment dates and dynamic
/// stamps with it).
fn clock() -> i64 {
    let t = local_now();
    if t.is_finite() { t as i64 } else { 0 }
}

fn err(e: impl ToString) -> JsError {
    JsError::new(&e.to_string())
}

fn f(v: &Value) -> Option<f64> {
    v.as_f64().filter(|x| x.is_finite())
}

fn num(v: &Value, key: &str, default: f64) -> f64 {
    f(&v[key]).unwrap_or(default)
}

fn idx(v: &Value, key: &str) -> usize {
    v[key].as_u64().unwrap_or(0) as usize
}

fn text(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or("").to_string()
}

fn list(v: &Value) -> Vec<usize> {
    v.as_array().map(|a| a.iter().filter_map(|p| p.as_u64().map(|p| p as usize)).collect()).unwrap_or_default()
}

fn rect4(v: &Value) -> Option<[f32; 4]> {
    let a = v.as_array()?;
    let g = |i: usize| a.get(i).and_then(f).map(|x| x as f32);
    let (x0, y0, x1, y1) = (g(0)?, g(1)?, g(2)?, g(3)?);
    Some([x0.min(x1), y0.min(y1), x0.max(x1), y0.max(y1)])
}

fn point(v: &Value) -> Option<[f32; 2]> {
    let a = v.as_array()?;
    Some([a.first().and_then(f)? as f32, a.get(1).and_then(f)? as f32])
}

fn rgb(v: &Value) -> Option<[f32; 3]> {
    let a = v.as_array()?;
    let c = |i: usize| a.get(i).and_then(f).map(|x| x.clamp(0.0, 1.0) as f32);
    Some([c(0)?, c(1)?, c(2)?])
}

fn user_point(p: &PageInfo, v: [f32; 2]) -> [f64; 2] {
    let [x, y] = p.view_to_user(v[0], v[1]);
    [x as f64, y as f64]
}

fn user_rect(p: &PageInfo, r: [f32; 4]) -> [f64; 4] {
    p.view_rect_to_user(r).map(|x| x as f64)
}

fn view_rect(p: &PageInfo, r: [f64; 4]) -> [f32; 4] {
    let a = p.user_to_view(r[0] as f32, r[1] as f32);
    let b = p.user_to_view(r[2] as f32, r[3] as f32);
    [a[0].min(b[0]), a[1].min(b[1]), a[0].max(b[0]), a[1].max(b[1])]
}

fn view_quad(p: &PageInfo, q: &[f32; 8]) -> [f32; 4] {
    let mut r = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
    for i in 0..4 {
        let [x, y] = p.user_to_view(q[2 * i], q[2 * i + 1]);
        r = [r[0].min(x), r[1].min(y), r[2].max(x), r[3].max(y)];
    }
    r
}

fn rect_json(r: [f32; 4]) -> Value {
    json!([r[0], r[1], r[2], r[3]])
}

fn outline_json(items: &[OutlineItem]) -> Value {
    Value::Array(items.iter().map(|o| json!({ "title": o.title, "page": o.page, "open": o.open, "children": outline_json(&o.children) })).collect())
}

fn stamp_kind(name: &str) -> StampKind {
    StampKind::ALL.into_iter().find(|k| format!("{k:?}").eq_ignore_ascii_case(name)).unwrap_or(StampKind::Approved)
}

fn field_kind(k: FormFieldKind) -> &'static str {
    match k {
        FormFieldKind::Text => "text",
        FormFieldKind::CheckBox => "checkbox",
        FormFieldKind::Radio => "radio",
        FormFieldKind::PushButton => "button",
        FormFieldKind::Combo => "combo",
        FormFieldKind::List => "list",
        FormFieldKind::Signature => "signature",
    }
}

#[wasm_bindgen]
pub struct PdfWorkbench {
    session: Session,
    id: DocId,
}

#[wasm_bindgen]
impl PdfWorkbench {
    /// Opens a PDF. A wrong or missing password fails with the message "password".
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: Vec<u8>, name: String, password: Option<String>) -> Result<PdfWorkbench, JsError> {
        let mut session = Session::new().with_clock(clock);
        let id = session.open(name, None, Arc::new(bytes), password.as_deref()).map_err(|e| match e {
            pdfcraft_render::OpenError::WrongPassword => err("password"),
            other => err(other),
        })?;
        Ok(PdfWorkbench { session, id })
    }

    /// A new PDF of `pages` empty pages, `width` × `height` points.
    pub fn blank(width: f64, height: f64, pages: usize) -> Result<Vec<u8>, JsError> {
        let bytes = Session::new().with_clock(clock).create_blank(width, height, pages.clamp(1, 2000)).map_err(err)?;
        Ok(bytes.to_vec())
    }

    /// A PDF from an image file (PNG, JPEG, TIFF, GIF, BMP): one page sized to it.
    #[wasm_bindgen(js_name = fromImage)]
    pub fn from_image(name: String, bytes: Vec<u8>) -> Result<Vec<u8>, JsError> {
        let out = Session::new().with_clock(clock).create_from_images(&[(name, bytes)]).map_err(err)?;
        Ok(out.to_vec())
    }

    /// Several PDFs as one (Combine files).
    pub fn combine(first: Vec<u8>, second: Vec<u8>) -> Result<Vec<u8>, JsError> {
        let out = Session::new().combine(&[("first.pdf".into(), Arc::new(first)), ("second.pdf".into(), Arc::new(second))]).map_err(err)?;
        Ok(out.to_vec())
    }

    fn doc(&self) -> Result<&pdfcraft_engine::Document, JsError> {
        self.session.get(self.id).ok_or_else(|| err("the document is closed"))
    }

    fn page(&self, page: usize) -> Result<PageInfo, JsError> {
        self.doc()?.info.pages.get(page).cloned().ok_or_else(|| err(format!("there is no page {}", page + 1)))
    }

    #[wasm_bindgen(js_name = pageCount)]
    pub fn page_count(&self) -> usize {
        self.doc().map(|d| d.info.pages.len()).unwrap_or(0)
    }

    /// Everything the panels show, as JSON: pages, document properties, bookmarks, attachments,
    /// layers, comments, form fields, security, and the undo state.
    pub fn info(&self) -> Result<String, JsError> {
        let doc = self.doc()?;
        let info = &doc.info;
        let pages: Vec<Value> = info.pages.iter().map(|p| json!({ "width": p.width, "height": p.height, "rotation": p.rotation, "label": p.label })).collect();
        let comments: Vec<Value> = info
            .annotations
            .iter()
            .filter(|a| !matches!(a.subtype.as_str(), "Popup" | "Link" | "Widget"))
            .filter_map(|a| {
                let p = info.pages.get(a.page)?;
                let props = doc.comment_props(a.page, a.index);
                let quads: Vec<Value> = a.quads.iter().map(|q| rect_json(view_quad(p, q))).collect();
                let rect = view_rect(p, a.rect.map(|x| x as f64));
                Some(json!({
                    "page": a.page,
                    "index": a.index,
                    "subtype": a.subtype,
                    "kind": pdfcraft_engine::comment_kind(a),
                    "author": a.author,
                    "contents": a.contents,
                    "modified": a.modified,
                    "name": a.name,
                    "inReplyTo": a.in_reply_to,
                    "state": a.state,
                    "intent": a.intent,
                    "locked": a.locked,
                    "rect": rect_json(rect),
                    "quads": quads,
                    "color": props.as_ref().and_then(|p| p.color).or_else(|| a.color.map(|c| c.map(|x| x as f64))),
                    "opacity": props.as_ref().map(|p| p.opacity).unwrap_or(1.0),
                    "width": props.as_ref().and_then(|p| p.width),
                    "subject": props.as_ref().map(|p| p.subject.clone()),
                    "restylable": props.as_ref().map(|p| p.restylable).unwrap_or(false),
                }))
            })
            .collect();
        let fields: Vec<Value> = doc
            .form
            .iter()
            .map(|fl| {
                let widgets: Vec<Value> = fl
                    .widgets
                    .iter()
                    .filter_map(|w| {
                        let page = w.page?;
                        let p = info.pages.get(page)?;
                        Some(json!({ "page": page, "rect": rect_json(view_rect(p, w.rect)), "onState": w.on_state, "state": w.state, "hidden": w.hidden }))
                    })
                    .collect();
                json!({
                    "name": fl.name,
                    "kind": field_kind(fl.kind),
                    "value": fl.value,
                    "options": fl.options.iter().map(|(v, t)| json!([v, t])).collect::<Vec<_>>(),
                    "readOnly": fl.read_only(),
                    "required": fl.has(field_flags::REQUIRED),
                    "multiline": fl.has(field_flags::MULTILINE),
                    "multi": fl.has(field_flags::MULTI_SELECT),
                    "maxLen": fl.max_len,
                    "tooltip": fl.tooltip,
                    "widgets": widgets,
                })
            })
            .collect();
        let security = doc.security_summary().map(|s| json!({ "method": s.method, "owner": s.owner, "pending": s.pending }));
        let out = json!({
            "pages": pages,
            "title": info.title,
            "author": info.author,
            "subject": info.subject,
            "keywords": info.keywords,
            "creator": info.creator,
            "producer": info.producer,
            "pdfVersion": info.pdf_version,
            "fileSize": doc.bytes.len(),
            "encrypted": info.encrypted,
            "tagged": info.tagged,
            "outline": outline_json(&info.outline),
            "attachments": info.attachments.iter().map(|a| json!({ "name": a.name, "description": a.description, "size": a.size })).collect::<Vec<_>>(),
            "layers": info.layers.iter().map(|l| json!({ "name": l.name, "visible": l.visible })).collect::<Vec<_>>(),
            "fonts": info.fonts.iter().map(|f| f.name.clone()).collect::<Vec<_>>(),
            "comments": comments,
            "fields": fields,
            "security": security,
            "editable": doc.editable(),
            "readOnlyReason": doc.read_only_reason,
            "signed": doc.is_signed(),
            "redactionMarks": doc.redaction_marks(),
            "allows": {
                "print": doc.allows_printing(),
                "modify": doc.allows_modification(),
                "assemble": doc.allows_assembly(),
                "annotate": doc.allows_annotation(),
                "fill": doc.allows_form_filling(),
                "security": doc.allows_security_change(),
            },
            "undo": doc.can_undo(),
            "redo": doc.can_redo(),
            "dirty": doc.dirty,
            "warnings": info.warnings,
        });
        Ok(out.to_string())
    }

    /// One page with its comments and fields as straight RGBA8, `scale` pixels per point.
    pub fn render(&self, page: usize, scale: f32) -> Result<RenderedImage, JsError> {
        let doc = self.doc()?;
        let scale = if scale.is_finite() { scale.clamp(0.01, 16.0) } else { 1.0 };
        doc.renderer.set_queue(vec![RenderRequest { page, kind: RequestKind::Pixels, scale, ..Default::default() }]);
        let out = doc.renderer.try_recv().ok_or_else(|| err("the page couldn't be drawn"))?;
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

    /// A page's text layer as JSON: glyph boxes (view space, flattened `[x0,y0,x1,y1,…]`), their
    /// text, line index, and whether a word break comes before each.
    #[wasm_bindgen(js_name = textLayer)]
    pub fn text_layer(&self, page: usize) -> Result<String, JsError> {
        let doc = self.doc()?;
        doc.renderer.set_queue(vec![RenderRequest { page, kind: RequestKind::Text, scale: 1.0, ..Default::default() }]);
        let out = doc.renderer.try_recv().ok_or_else(|| err("the page's text couldn't be read"))?;
        let Some(t) = out.text else { return Ok(json!({ "boxes": [], "text": [], "line": [], "space": [] }).to_string()) };
        let boxes: Vec<f32> = t.glyphs.iter().flat_map(|g| g.rect).collect();
        let chars: Vec<&str> = t.glyphs.iter().map(|g| g.text.as_str()).collect();
        Ok(json!({ "boxes": boxes, "text": chars, "line": t.line_of, "space": t.space_before }).to_string())
    }

    /// The page's text as plain lines.
    #[wasm_bindgen(js_name = plainText)]
    pub fn plain_text(&self, page: usize) -> Result<String, JsError> {
        let doc = self.doc()?;
        doc.renderer.set_queue(vec![RenderRequest { page, kind: RequestKind::Text, scale: 1.0, ..Default::default() }]);
        Ok(doc.renderer.try_recv().and_then(|o| o.text).map(|t| t.plain_text()).unwrap_or_default())
    }

    /// Lines of existing text that Edit text can change: `[{text, rect, font, size, bold, italic, color, decodable}]`.
    #[wasm_bindgen(js_name = textLines)]
    pub fn text_lines(&self, page: usize) -> Result<String, JsError> {
        let p = self.page(page)?;
        let lines: Vec<Value> = self
            .doc()?
            .text_lines(page)
            .iter()
            .map(|l| json!({ "text": l.text, "rect": rect_json(view_rect(&p, l.rect)), "font": l.base_font, "size": l.size, "bold": l.bold, "italic": l.italic, "color": l.color, "decodable": l.decodable }))
            .collect();
        Ok(Value::Array(lines).to_string())
    }

    /// Paragraphs of existing text: `[{text, rect, font, size, bold, italic, color, lines}]`.
    #[wasm_bindgen(js_name = textBlocks)]
    pub fn text_blocks(&self, page: usize) -> Result<String, JsError> {
        let p = self.page(page)?;
        let blocks: Vec<Value> = self
            .doc()?
            .text_blocks(page)
            .iter()
            .map(|b| json!({ "text": b.text, "rect": rect_json(view_rect(&p, b.rect)), "font": b.base_font, "size": b.size, "bold": b.bold, "italic": b.italic, "color": b.color, "lines": b.lines }))
            .collect();
        Ok(Value::Array(blocks).to_string())
    }

    /// Images (and grouped artwork) drawn on a page: `[{rect, width, height, form}]`.
    #[wasm_bindgen(js_name = pageImages)]
    pub fn page_images(&self, page: usize) -> Result<String, JsError> {
        let p = self.page(page)?;
        let images: Vec<Value> =
            self.doc()?.page_images(page).iter().map(|i| json!({ "rect": rect_json(view_rect(&p, i.rect)), "width": i.width, "height": i.height, "form": i.is_form })).collect();
        Ok(Value::Array(images).to_string())
    }

    /// Runs an edit given as JSON (see `edit_from`). Each is one undo step.
    pub fn apply(&mut self, json: &str) -> Result<(), JsError> {
        let v: Value = serde_json::from_str(json).map_err(err)?;
        let edit = self.edit_from(&v)?;
        self.session.apply(self.id, edit).map_err(err)
    }

    /// Inserts the pages of another PDF at `at` (Insert from file, Merge).
    #[wasm_bindgen(js_name = insertPdf)]
    pub fn insert_pdf(&mut self, at: usize, name: String, bytes: Vec<u8>) -> Result<(), JsError> {
        self.session.apply(self.id, Edit::InsertPagesFrom { name, bytes: Arc::new(bytes), pages: None, at }).map_err(err)
    }

    /// A picture (PNG or JPEG: an uploaded or drawn signature, an image stamp) as a stamp comment
    /// filling `rect` (view space).
    #[wasm_bindgen(js_name = addPicture)]
    pub fn add_picture(&mut self, page: usize, rect: &str, name: String, bytes: Vec<u8>, author: String) -> Result<(), JsError> {
        let p = self.page(page)?;
        let r = rect4(&serde_json::from_str(rect).map_err(err)?).ok_or_else(|| err("a rectangle is needed"))?;
        let file = MarkFile { name: name.clone(), bytes: Arc::new(bytes), page: 0 };
        self.session.apply(self.id, Edit::AddCustomStamp { page, rect: user_rect(&p, r), name, file, author }).map_err(err)
    }

    /// Edit text and images ▸ Add image: an image drawn into the page content at `rect` (view space).
    #[wasm_bindgen(js_name = addImage)]
    pub fn add_image(&mut self, page: usize, rect: &str, name: String, bytes: Vec<u8>) -> Result<(), JsError> {
        let p = self.page(page)?;
        let r = rect4(&serde_json::from_str(rect).map_err(err)?).ok_or_else(|| err("a rectangle is needed"))?;
        let display = [r[0] as f64, (p.height - r[3]) as f64, r[2] as f64, (p.height - r[1]) as f64];
        self.session.apply(self.id, Edit::AddImage { page, rect: Some(display), name, bytes: Arc::new(bytes) }).map_err(err)
    }

    /// Edit text and images ▸ Replace image: image `index` on `page` shows this file instead.
    #[wasm_bindgen(js_name = replaceImage)]
    pub fn replace_image(&mut self, page: usize, index: usize, name: String, bytes: Vec<u8>) -> Result<(), JsError> {
        self.session.apply(self.id, Edit::EditPageImage { page, index, change: ImageEdit::Replace { name, bytes: Arc::new(bytes) } }).map_err(err)
    }

    /// Undoes the last edit; returns its label, or nothing when there is none.
    pub fn undo(&mut self) -> Result<Option<String>, JsError> {
        if self.doc()?.can_undo().is_none() {
            return Ok(None);
        }
        self.session.undo(self.id).map(Some).map_err(err)
    }

    pub fn redo(&mut self) -> Result<Option<String>, JsError> {
        if self.doc()?.can_redo().is_none() {
            return Ok(None);
        }
        self.session.redo(self.id).map(Some).map_err(err)
    }

    /// The document as PDF bytes (an incremental update of what was opened or last saved, or a
    /// compact full rewrite), and editing continues from them.
    pub fn save(&mut self, full: bool) -> Result<Vec<u8>, JsError> {
        let doc = self.doc()?;
        let pending_protection = doc.security_summary().is_some_and(|s| s.pending);
        let bytes = if full || pending_protection { self.session.save_full_bytes(self.id) } else { self.session.save_bytes(self.id) }.map_err(err)?;
        self.session.mark_saved(self.id, bytes.clone(), None).map_err(err)?;
        Ok(bytes.to_vec())
    }

    /// Reduce File Size: a compressed, optimized copy (the open document is unchanged).
    pub fn reduced(&self) -> Result<Vec<u8>, JsError> {
        let (bytes, _) = self.session.reduced_bytes(self.id).map_err(err)?;
        Ok(bytes.to_vec())
    }

    /// A new PDF of just these pages (JSON list, 0-based).
    pub fn extract(&self, pages: &str) -> Result<Vec<u8>, JsError> {
        let pages = list(&serde_json::from_str(pages).map_err(err)?);
        Ok(self.session.extract(self.id, &pages).map_err(err)?.to_vec())
    }

    /// The bytes of attachment `index`.
    pub fn attachment(&self, index: usize) -> Result<Vec<u8>, JsError> {
        let doc = self.doc()?;
        let att = doc.info.attachments.get(index).ok_or_else(|| err("there is no such attachment"))?;
        pdfcraft_render::attachment_data(&doc.bytes, doc.password.as_deref(), att).map_err(err)
    }

    /// Shows or hides layer `index` (optional content) in the view.
    #[wasm_bindgen(js_name = setLayerVisible)]
    pub fn set_layer_visible(&mut self, index: usize, visible: bool) -> bool {
        self.session.set_layer_visible(self.id, index, visible)
    }

    /// A dynamic stamp's "By … at …" line, for previews.
    #[wasm_bindgen(js_name = stampByLine)]
    pub fn stamp_by_line(&self, author: &str) -> String {
        self.session.stamp_by_line(author)
    }
}

impl PdfWorkbench {
    /// Turns a JSON edit into an engine edit. `op` names it; geometry is in view space.
    fn edit_from(&self, v: &Value) -> Result<Edit, JsError> {
        let page_of = |v: &Value| self.page(idx(v, "page"));
        Ok(match v["op"].as_str().unwrap_or("") {
            "rotate" => Edit::RotatePages { pages: list(&v["pages"]), degrees: v["degrees"].as_i64().unwrap_or(90) },
            "delete" => Edit::DeletePages { pages: list(&v["pages"]) },
            "move" => Edit::MovePages { pages: list(&v["pages"]), to: idx(v, "to") },
            "duplicate" => Edit::DuplicatePages { pages: list(&v["pages"]) },
            "insertBlank" => Edit::InsertBlankPage { at: idx(v, "at"), width: num(v, "width", 612.0), height: num(v, "height", 792.0) },
            "setInfo" => Edit::SetInfo { key: text(v, "key"), value: text(v, "value") },
            "addBookmark" => Edit::AddBookmark { parent: list(&v["parent"]), index: idx(v, "index"), title: text(v, "title"), page: idx(v, "page") },
            "renameBookmark" => Edit::RenameBookmark { path: list(&v["path"]), title: text(v, "title") },
            "deleteBookmark" => Edit::DeleteBookmark { path: list(&v["path"]) },
            "annotate" => Edit::AddAnnotation(self.annotation(v)?),
            "deleteAnnotation" => Edit::DeleteAnnotation { page: idx(v, "page"), index: idx(v, "index") },
            "setContents" => Edit::SetAnnotationContents { page: idx(v, "page"), index: idx(v, "index"), text: text(v, "text") },
            "reply" => Edit::ReplyToAnnotation { page: idx(v, "page"), index: idx(v, "index"), text: text(v, "text"), author: text(v, "author") },
            "moveAnnotation" => {
                let p = page_of(v)?;
                let a = user_point(&p, [0.0, 0.0]);
                let b = user_point(&p, [num(v, "dx", 0.0) as f32, num(v, "dy", 0.0) as f32]);
                Edit::MoveAnnotation { page: idx(v, "page"), index: idx(v, "index"), dx: b[0] - a[0], dy: b[1] - a[1] }
            }
            "resizeAnnotation" => {
                let p = page_of(v)?;
                let r = rect4(&v["rect"]).ok_or_else(|| err("a rectangle is needed"))?;
                Edit::ResizeAnnotation { page: idx(v, "page"), index: idx(v, "index"), rect: user_rect(&p, r) }
            }
            "styleAnnotation" => Edit::StyleAnnotation {
                page: idx(v, "page"),
                index: idx(v, "index"),
                color: rgb(&v["color"]).map(|c| c.map(|x| x as f64)),
                opacity: f(&v["opacity"]).map(|o| o.clamp(0.0, 1.0)),
                width: f(&v["width"]).map(|w| w.max(0.0)),
                endings: None,
            },
            "setAnnotationInfo" => Edit::SetAnnotationInfo {
                page: idx(v, "page"),
                index: idx(v, "index"),
                author: v["author"].as_str().map(str::to_string),
                subject: v["subject"].as_str().map(str::to_string),
                icon: None,
            },
            "setField" => {
                let name = text(v, "name");
                let doc = self.doc()?;
                let field = doc.form.iter().find(|fl| fl.name == name).ok_or_else(|| err(format!("there is no field named {name}")))?;
                let value = &v["value"];
                let value = match field.kind {
                    FormFieldKind::CheckBox => FieldValue::Check(value.as_bool().unwrap_or(false)),
                    FormFieldKind::Radio => FieldValue::Radio(value.as_str().filter(|s| !s.is_empty()).map(str::to_string)),
                    FormFieldKind::Combo | FormFieldKind::List => FieldValue::Choice(match value {
                        Value::Array(a) => a.iter().filter_map(|s| s.as_str().map(str::to_string)).collect(),
                        Value::String(s) if !s.is_empty() => vec![s.clone()],
                        _ => Vec::new(),
                    }),
                    _ => FieldValue::Text(value.as_str().unwrap_or("").to_string()),
                };
                // A check box or radio button drawn without appearances gets them on the first
                // set, and its on state only from then on: set it twice, as one step.
                let needs_states = matches!(field.kind, FormFieldKind::CheckBox | FormFieldKind::Radio) && field.widgets.iter().any(|w| w.on_state.is_none());
                let set = Edit::SetFieldValue { name, value };
                if needs_states { Edit::Batch { label: "Fill in field".into(), edits: vec![set.clone(), set] } } else { set }
            }
            "resetForm" => Edit::ResetForm { names: None },
            "addField" => {
                let p = page_of(v)?;
                let r = rect4(&v["rect"]).ok_or_else(|| err("a rectangle is needed"))?;
                let kind = match v["kind"].as_str().unwrap_or("text") {
                    "checkbox" => pdfcraft_engine::NewField::CheckBox,
                    "date" => pdfcraft_engine::NewField::Date,
                    "multiline" => pdfcraft_engine::NewField::Text { multiline: true },
                    _ => pdfcraft_engine::NewField::Text { multiline: false },
                };
                Edit::AddField { page: idx(v, "page"), rect: user_rect(&p, r), kind, name: v["name"].as_str().filter(|s| !s.is_empty()).map(str::to_string) }
            }
            "deleteField" => Edit::DeleteField { name: text(v, "name") },
            "editTextLine" => Edit::EditTextLine { page: idx(v, "page"), line: idx(v, "line"), text: text(v, "text") },
            "editTextBlock" => Edit::EditTextBlock { page: idx(v, "page"), block: idx(v, "block"), text: text(v, "text"), style: Default::default() },
            "editImage" => {
                let p = page_of(v)?;
                let change = if v["delete"].as_bool().unwrap_or(false) {
                    ImageEdit::Delete
                } else if let Some(r) = rect4(&v["rect"]) {
                    ImageEdit::Move(user_rect(&p, r))
                } else if let Some(turns) = v["rotate"].as_i64() {
                    ImageEdit::Rotate(turns as i32)
                } else {
                    ImageEdit::Flip { horizontal: v["flip"].as_str() != Some("vertical") }
                };
                Edit::EditPageImage { page: idx(v, "page"), index: idx(v, "index"), change }
            }
            "addText" => {
                let p = page_of(v)?;
                let r = rect4(&v["rect"]).ok_or_else(|| err("a rectangle is needed"))?;
                let color = rgb(&v["color"]).unwrap_or([0.0; 3]).map(|x| x as f64);
                let rect = [r[0] as f64, (p.height - r[3]) as f64, r[2] as f64, (p.height - r[1]) as f64];
                Edit::AddText { page: idx(v, "page"), text: AddedText { rect, text: text(v, "text"), size: num(v, "size", 12.0).clamp(1.0, 400.0), color, ..Default::default() } }
            }
            "applyRedactions" => Edit::ApplyRedactions { pages: v.get("pages").filter(|p| p.is_array()).map(list) },
            "clearRedactions" => Edit::ClearRedactions,
            "protect" => {
                let pw = |k: &str| v[k].as_str().filter(|s| !s.is_empty()).map(str::to_string);
                Edit::Protect(Protection {
                    open_password: pw("openPassword"),
                    permissions_password: pw("permissionsPassword"),
                    printing: match v["printing"].as_str() {
                        Some("none") => Printing::None,
                        Some("low") => Printing::Low,
                        _ => Printing::High,
                    },
                    changes: match v["changes"].as_str() {
                        Some("pages") => Changes::Pages,
                        Some("fill") => Changes::FillSign,
                        Some("comment") => Changes::CommentFillSign,
                        Some("any") => Changes::AnyExceptExtract,
                        _ => Changes::None,
                    },
                    copy: v["copy"].as_bool().unwrap_or(false),
                    ..Default::default()
                })
            }
            "removeProtection" => Edit::RemoveProtection,
            "flatten" => Edit::Flatten { comments: v["comments"].as_bool().unwrap_or(true), fields: v["fields"].as_bool().unwrap_or(true) },
            "sanitize" => Edit::Sanitize,
            "batch" => Edit::Batch {
                label: text(v, "label"),
                edits: v["edits"].as_array().map(|a| a.iter().map(|e| self.edit_from(e)).collect::<Result<Vec<_>, _>>()).transpose()?.unwrap_or_default(),
            },
            other => return Err(err(format!("unknown edit {other}"))),
        })
    }

    /// A new comment from JSON: `kind` and its geometry (view space), plus style and text.
    fn annotation(&self, v: &Value) -> Result<NewAnnotation, JsError> {
        let page = idx(v, "page");
        let p = self.page(page)?;
        let need_rect = || rect4(&v["rect"]).map(|r| user_rect(&p, r)).ok_or_else(|| err("a rectangle is needed"));
        let pt = |key: &str| point(&v[key]).map(|q| user_point(&p, q)).ok_or_else(|| err(format!("{key} is needed")));
        let strokes = || -> Vec<Vec<[f64; 2]>> {
            v["strokes"]
                .as_array()
                .map(|s| s.iter().map(|stroke| stroke.as_array().map(|pts| pts.iter().filter_map(point).map(|q| user_point(&p, q)).collect()).unwrap_or_default()).collect())
                .unwrap_or_default()
        };
        let quads = || -> Vec<[f64; 8]> {
            let rects: Vec<[f32; 4]> = match v["rects"].as_array() {
                Some(a) => a.iter().filter_map(rect4).collect(),
                None => rect4(&v["rect"]).into_iter().collect(),
            };
            rects.into_iter().map(|r| p.view_rect_to_quad(r)).collect()
        };
        let author = text(v, "author");
        let shape = match v["kind"].as_str().unwrap_or("") {
            "note" => Shape::Note { at: pt("at")?, icon: NoteIcon::Comment },
            "highlight" => Shape::TextMarkup { kind: Markup::Highlight, quads: quads() },
            "underline" => Shape::TextMarkup { kind: Markup::Underline, quads: quads() },
            "strikeout" => Shape::TextMarkup { kind: Markup::StrikeOut, quads: quads() },
            "squiggly" => Shape::TextMarkup { kind: Markup::Squiggly, quads: quads() },
            "rect" => Shape::Rectangle { rect: need_rect()? },
            "oval" => Shape::Oval { rect: need_rect()? },
            "line" => Shape::Line { from: pt("from")?, to: pt("to")?, start: LineEnding::None, end: LineEnding::None },
            "arrow" => Shape::Line { from: pt("from")?, to: pt("to")?, start: LineEnding::None, end: LineEnding::OpenArrow },
            "ink" => Shape::Ink { strokes: strokes() },
            "signature" => Shape::Signature { strokes: strokes() },
            "textbox" => Shape::TextBox { rect: need_rect()?, font_size: num(v, "fontSize", 12.0).clamp(4.0, 144.0) },
            "typewriter" => Shape::Typewriter { rect: need_rect()?, font_size: num(v, "fontSize", 12.0).clamp(4.0, 144.0) },
            "check" => Shape::Mark { rect: need_rect()?, mark: FillMark::Check },
            "cross" => Shape::Mark { rect: need_rect()?, mark: FillMark::Cross },
            "dot" => Shape::Mark { rect: need_rect()?, mark: FillMark::Dot },
            "stamp" => {
                let stamp = stamp_kind(v["stamp"].as_str().unwrap_or("Approved"));
                let by = (stamp.group() == pdfcraft_engine::StampGroup::Dynamic).then(|| self.session.stamp_by_line(&author));
                Shape::Stamp { rect: need_rect()?, stamp, by }
            }
            "typedSignature" => {
                let height = num(v, "height", 24.0).clamp(4.0, 400.0);
                pdfcraft_engine::typed_signature_shape(pt("at")?, &text(v, "text"), height, p.rotation as i64).ok_or_else(|| err("type a name to sign with"))?
            }
            "redact" => Shape::Redact { quads: quads(), overlay: text(v, "overlay"), look: OverlayLook::default() },
            other => return Err(err(format!("unknown comment kind {other}"))),
        };
        let mut style = Style::default_for(&shape);
        if let Some(c) = rgb(&v["color"]) {
            style.color = c.map(|x| x as f64);
        }
        if let Some(o) = f(&v["opacity"]) {
            style.opacity = o.clamp(0.0, 1.0);
        }
        if let Some(w) = f(&v["width"]) {
            style.width = w.clamp(0.0, 50.0);
        }
        if let Some(c) = rgb(&v["fill"]) {
            style.fill = Some(c.map(|x| x as f64));
        }
        Ok(NewAnnotation { page, shape, style, contents: text(v, "contents"), author })
    }
}
