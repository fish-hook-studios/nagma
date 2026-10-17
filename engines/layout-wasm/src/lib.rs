//! DesignCraft's layout engine for Nagma: open an InDesign (IDML) or DesignCraft file, draw its
//! pages, and flatten each page into simple shapes, text paragraphs and images that Nagma turns
//! into editable layers. Text comes from DesignCraft's own composer (Knuth–Plass line breaking,
//! threading across frames, parent pages), so what lands in Nagma matches the layout.

use std::collections::HashMap;
use std::sync::Arc;

use designcraft_compose::{Cache, ComposedStory, FrameText};
use designcraft_doc::{Content, Document, Item, PageSide, Shape};
use designcraft_geom::{Affine, BezPath, PathEl, Point, Rect, Shape as _, Vec2};
use designcraft_render::{RenderOptions, Renderer};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

fn err(e: impl ToString) -> JsError {
    JsError::new(&e.to_string())
}

#[wasm_bindgen]
pub struct LayoutDoc {
    doc: Document,
    cache: Cache,
    renderer: Renderer,
}

#[wasm_bindgen]
impl LayoutDoc {
    /// Opens an `.idml` or `.designcraft` file.
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: Vec<u8>) -> Result<LayoutDoc, JsError> {
        let doc = if designcraft_idml::is_idml(&bytes) {
            designcraft_idml::import_idml(&bytes).map_err(err)?
        } else {
            designcraft_format::load(&bytes).map_err(err)?
        };
        Ok(Self::with(doc))
    }

    /// DesignCraft's sample magazine.
    pub fn sample() -> LayoutDoc {
        Self::with(designcraft_engine::sample::magazine())
    }

    pub fn title(&self) -> String {
        self.doc.title.clone()
    }

    #[wasm_bindgen(js_name = pageCount)]
    pub fn page_count(&self) -> usize {
        self.doc.page_count()
    }

    /// One page as straight RGBA8 at `scale` pixels per point.
    pub fn render(&mut self, page: usize, scale: f64) -> Result<RenderedImage, JsError> {
        let opts = RenderOptions::default();
        let out = self.renderer.render_page(&self.doc, &self.cache, page, scale, false, &opts).ok_or_else(|| err("no such page"))?;
        Ok(RenderedImage { width: out.width, height: out.height, rgba: out.to_straight() })
    }

    /// A page flattened into simple layers, as JSON (see `Flatten`).
    pub fn page(&self, page: usize) -> Result<String, JsError> {
        let (si, pi) = self.doc.page_loc(page).ok_or_else(|| err("no such page"))?;
        let mut f = Flatten { doc: &self.doc, cache: &self.cache, stories: HashMap::new(), assets: Vec::new(), skipped: 0, page_name: String::new() };
        Ok(f.page(page, si, pi).to_string())
    }

    /// The bytes of an image the page refers to, as a browser can show it: web formats as they
    /// are, anything else (PDF, TIFF, PSD, EPS previews) decoded to PNG.
    pub fn asset(&self, id: &str) -> Result<AssetData, JsError> {
        let asset = self.doc.assets.iter().find(|(k, _)| k.0.to_string() == id).map(|(_, a)| a).ok_or_else(|| err("no such image"))?;
        if matches!(asset.mime.as_str(), "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml") {
            return Ok(AssetData { mime: asset.mime.clone(), bytes: asset.data.to_vec() });
        }
        let pm = designcraft_render::decode_pixmap_page(&asset.data, asset.page).ok_or_else(|| err(format!("can't decode {}", asset.name)))?;
        let rendered = designcraft_render::Rendered { width: pm.width() as u32, height: pm.height() as u32, pixels: pm.data_as_u8_slice().to_vec() };
        Ok(AssetData { mime: "image/png".into(), bytes: rendered.to_png() })
    }

    /// The document as InDesign Markup (IDML).
    #[wasm_bindgen(js_name = exportIdml)]
    pub fn export_idml(&self) -> Vec<u8> {
        designcraft_idml::export_idml(&self.doc)
    }

    /// The document as a `.designcraft` file.
    pub fn save(&self) -> Result<Vec<u8>, JsError> {
        designcraft_format::save(&self.doc).map_err(err)
    }
}

impl LayoutDoc {
    fn with(doc: Document) -> LayoutDoc {
        let mut renderer = Renderer::new();
        renderer.threads = 0;
        LayoutDoc { doc, cache: Cache::new(), renderer }
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
pub struct AssetData {
    mime: String,
    bytes: Vec<u8>,
}

#[wasm_bindgen]
impl AssetData {
    #[wasm_bindgen(getter)]
    pub fn mime(&self) -> String {
        self.mime.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn bytes(&self) -> Vec<u8> {
        self.bytes.clone()
    }
}

fn hex(c: [u8; 4]) -> String {
    format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])
}

/// A box in page space: the unrotated size, its centre, and the rotation (degrees, clockwise).
/// `None` when the matrix skews or mirrors (callers fall back to a path).
fn boxed(m: Affine, r: Rect) -> Option<Value> {
    let [a, b, c, d, _, _] = m.as_coeffs();
    let sx = a.hypot(b);
    let det = a * d - b * c;
    if sx < 1e-9 || det <= 0.0 {
        return None;
    }
    let sy = det / sx;
    // Columns must stay perpendicular (no skew).
    if (a * c + b * d).abs() > 1e-6 * sx * sy.max(1e-9) * 10.0 {
        return None;
    }
    let centre = m * r.center();
    let w = r.width() * sx;
    let h = r.height() * sy;
    let rotation = b.atan2(a).to_degrees();
    Some(json!({ "x": centre.x - w / 2.0, "y": centre.y - h / 2.0, "w": w, "h": h, "rotation": round(rotation) }))
}

fn round(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

fn pt(p: Point) -> Value {
    json!([round(p.x), round(p.y)])
}

/// A bezier path as subpaths of `[x, y, inX, inY, outX, outY]` anchors (handles absolute, null
/// when straight), in page space.
fn subpaths(bp: &BezPath, m: Affine) -> Value {
    let mut out: Vec<Value> = Vec::new();
    let mut points: Vec<[Option<Point>; 3]> = Vec::new();
    let mut closed = false;
    let mut last = Point::ZERO;
    let flush = |points: &mut Vec<[Option<Point>; 3]>, closed: bool, out: &mut Vec<Value>| {
        if points.len() >= 2 || (points.len() == 1 && closed) {
            // A closing segment that returns to the start merges into the first anchor.
            if closed && points.len() > 1 {
                let first = points[0][0].unwrap_or_default();
                let lastp = points[points.len() - 1][0].unwrap_or_default();
                if (first - lastp).hypot() < 1e-6 {
                    let tail = points.pop().unwrap_or_default();
                    points[0][1] = tail[1];
                }
            }
            let list: Vec<Value> = points
                .iter()
                .map(|[p, i, o]| json!({ "p": pt(m * p.unwrap_or_default()), "in": i.map(|i| pt(m * i)), "out": o.map(|o| pt(m * o)) }))
                .collect();
            out.push(json!({ "points": list, "closed": closed }));
        }
        points.clear();
    };
    for el in bp.elements() {
        match *el {
            PathEl::MoveTo(p) => {
                flush(&mut points, closed, &mut out);
                closed = false;
                points.push([Some(p), None, None]);
                last = p;
            }
            PathEl::LineTo(p) => {
                points.push([Some(p), None, None]);
                last = p;
            }
            PathEl::QuadTo(q, p) => {
                let c1 = last + (q - last) * (2.0 / 3.0);
                let c2 = p + (q - p) * (2.0 / 3.0);
                if let Some(prev) = points.last_mut() {
                    prev[2] = Some(c1);
                }
                points.push([Some(p), Some(c2), None]);
                last = p;
            }
            PathEl::CurveTo(c1, c2, p) => {
                if let Some(prev) = points.last_mut() {
                    prev[2] = Some(c1);
                }
                points.push([Some(p), Some(c2), None]);
                last = p;
            }
            PathEl::ClosePath => {
                closed = true;
                flush(&mut points, closed, &mut out);
                closed = false;
            }
        }
    }
    flush(&mut points, closed, &mut out);
    Value::Array(out)
}

/// Whether a path is just its bounding rectangle.
fn is_rect(bp: &BezPath) -> bool {
    let r = bp.bounding_box();
    let mut n = 0;
    for el in bp.elements() {
        let p = match *el {
            PathEl::MoveTo(p) | PathEl::LineTo(p) => p,
            PathEl::ClosePath => continue,
            _ => return false,
        };
        let on_x = (p.x - r.x0).abs() < 1e-6 || (p.x - r.x1).abs() < 1e-6;
        let on_y = (p.y - r.y0).abs() < 1e-6 || (p.y - r.y1).abs() < 1e-6;
        if !on_x || !on_y {
            return false;
        }
        n += 1;
    }
    (4..=5).contains(&n)
}

struct Flatten<'a> {
    doc: &'a Document,
    cache: &'a Cache,
    stories: HashMap<(u64, Option<String>), Arc<ComposedStory>>,
    assets: Vec<String>,
    skipped: usize,
    // The page being flattened, for page-number characters.
    page_name: String,
}

impl Flatten<'_> {
    fn page(&mut self, abs: usize, si: usize, pi: usize) -> Value {
        let doc = self.doc;
        let sp = &doc.spreads[si];
        let page = &sp.pages[pi];
        let page_name = doc.page_name(abs);
        self.page_name = page_name.clone();
        // Page space: the page's top-left corner is (0, 0).
        let origin = Affine::translate((-page.x, 0.0));
        let mut items = Vec::new();
        for layer in doc.layers.iter().rev() {
            if !layer.visible {
                continue;
            }
            // Parent page items first, as DesignCraft draws them.
            if page.show_parent_items
                && let Some((ppi, ppage)) = doc.parent_page_for(abs)
            {
                let parent = &doc.parents[ppi];
                let dx = page.x - parent.pages[ppage].x;
                for it in &parent.items {
                    if it.layer != layer.id || page.overridden.contains(&it.id) {
                        continue;
                    }
                    if parent.pages.len() > 1 && parent.page_at_x(it.bounds().center().x) != Some(ppage) {
                        continue;
                    }
                    if let Some(v) = self.item(it, origin * Affine::translate((dx, 0.0)), Some(&page_name)) {
                        items.push(v);
                    }
                }
            }
            for it in &sp.items {
                if it.layer != layer.id {
                    continue;
                }
                // Items belong to the page under their centre (spreads hold two or more pages).
                if sp.pages.len() > 1 && sp.page_at_x(it.bounds().center().x) != Some(pi) {
                    continue;
                }
                if let Some(v) = self.item(it, origin, None) {
                    items.push(v);
                }
            }
        }
        let paper = doc.resolve_color(designcraft_color::swatch::PAPER, 1.0).unwrap_or(designcraft_color::Color::WHITE);
        let _ = PageSide::Left;
        json!({
            "name": page_name,
            "width": page.width,
            "height": page.height,
            "paper": hex(paper.to_rgba8(1.0)),
            "items": items,
            "assets": self.assets,
            "skipped": self.skipped,
        })
    }

    fn story(&mut self, sid: designcraft_doc::StoryId, page_name: Option<&str>) -> Arc<ComposedStory> {
        let key = (sid.0 as u64, page_name.map(str::to_string));
        if let Some(cs) = self.stories.get(&key) {
            return cs.clone();
        }
        let cs = self.cache.get(self.doc, sid, page_name);
        self.stories.insert(key, cs.clone());
        cs
    }

    fn color(&self, swatch: &str, tint: f32) -> Option<String> {
        self.doc.resolve_color(swatch, tint).map(|c| hex(c.to_rgba8(1.0)))
    }

    /// A fill: a solid colour or a gradient (end points in page space).
    fn fill(&self, it: &Item, m: Affine, bp: &BezPath) -> Value {
        let fill = &it.fill;
        if fill.is_none() {
            return Value::Null;
        }
        if let Some(g) = designcraft_color::swatch::resolve_gradient(&self.doc.swatches, &fill.swatch) {
            let stops: Vec<Value> = g.expanded_stops().iter().map(|(o, c, a)| json!({ "position": o, "color": hex(c.to_rgba8(1.0)), "opacity": a })).collect();
            let bounds = bp.bounding_box();
            let c = bounds.center();
            let radial = g.kind == designcraft_color::GradientKind::Radial;
            let (from, to) = match fill.gradient_vector {
                Some([x0, y0, x1, y1]) => (Point::new(x0, y0), Point::new(x1, y1)),
                None if radial => (c, c + Vec2::new(bounds.width().max(bounds.height()) / 2.0, 0.0)),
                None => {
                    let a = fill.gradient_angle.unwrap_or(0.0).to_radians();
                    let half = (bounds.width() * a.cos().abs() + bounds.height() * a.sin().abs()) / 2.0;
                    let d = Vec2::new(a.cos(), -a.sin()) * half;
                    (c - d, c + d)
                }
            };
            return json!({ "type": if radial { "radial" } else { "linear" }, "stops": stops, "from": pt(m * from), "to": pt(m * to) });
        }
        match self.color(&fill.swatch, fill.tint) {
            Some(color) => json!({ "type": "solid", "color": color }),
            None => Value::Null,
        }
    }

    fn stroke(&self, it: &Item, scale: f64) -> Value {
        let st = &it.stroke;
        if st.is_none() || st.weight <= 0.0 {
            return Value::Null;
        }
        let Some(color) = self.color(&st.swatch, st.tint) else { return Value::Null };
        let align = match st.align {
            designcraft_doc::StrokeAlign::Inside => "inside",
            designcraft_doc::StrokeAlign::Outside => "outside",
            _ => "center",
        };
        json!({ "color": color, "weight": round(st.weight * scale), "align": align })
    }

    fn shadow(&self, it: &Item, scale: f64) -> Value {
        let ds = &it.effects.drop_shadow;
        if !ds.on {
            return Value::Null;
        }
        let angle = if ds.global_light { self.doc.settings.global_light } else { ds.angle }.to_radians();
        let color = self.color(&ds.color, 1.0).unwrap_or_else(|| "#000000".into());
        json!({ "x": round(-angle.cos() * ds.distance * scale), "y": round(angle.sin() * ds.distance * scale), "blur": round(ds.size * scale), "color": color, "opacity": ds.opacity })
    }

    /// The common part of every layer: name, opacity, blending, geometry.
    fn base(&self, it: &Item, kind: &str, m: Affine, bp: &BezPath) -> serde_json::Map<String, Value> {
        let scale = m.determinant().abs().sqrt();
        let mut o = serde_json::Map::new();
        o.insert("kind".into(), json!(kind));
        o.insert("name".into(), json!(it.name));
        o.insert("opacity".into(), json!(it.opacity));
        o.insert("blend".into(), serde_json::to_value(it.blend).unwrap_or(Value::Null));
        o.insert("locked".into(), json!(it.locked));
        let r = bp.bounding_box();
        o.insert("box".into(), boxed(m, r).unwrap_or(Value::Null));
        o.insert("bounds".into(), {
            let b = m.transform_rect_bbox(r);
            json!({ "x": b.x0, "y": b.y0, "w": b.width(), "h": b.height() })
        });
        o.insert("shadow".into(), self.shadow(it, scale));
        o
    }

    fn item(&mut self, it: &Item, parent: Affine, page_name: Option<&str>) -> Option<Value> {
        if it.hidden || it.nonprinting {
            return None;
        }
        let m = parent * it.xf;
        let scale = m.determinant().abs().sqrt();
        let bp = if it.corners.is_none() { it.path.to_bezpath() } else { designcraft_geom::corners::apply(&it.path, &it.corners) };
        // A frame with items pasted into it.
        if it.has_nested_items() {
            let mut o = self.base(it, "clip", m, &bp);
            o.insert("fill".into(), self.fill(it, m, &bp));
            o.insert("stroke".into(), self.stroke(it, scale));
            o.insert("path".into(), subpaths(&bp, m));
            let children: Vec<Value> = it.children().iter().filter_map(|c| self.item(c, m, page_name)).collect();
            o.insert("children".into(), Value::Array(children));
            return Some(Value::Object(o));
        }
        if !it.children().is_empty() {
            let mut o = self.base(it, "group", m, &bp);
            let children: Vec<Value> = it.shown_children().filter_map(|c| self.item(c, m, page_name)).collect();
            if children.is_empty() {
                return None;
            }
            o.insert("children".into(), Value::Array(children));
            return Some(Value::Object(o));
        }
        let shape = if it.shape == Shape::Oval {
            "ellipse"
        } else if it.corners.is_none() && is_rect(&bp) {
            "rect"
        } else {
            "path"
        };
        let mut o = self.base(it, shape, m, &bp);
        o.insert("closed".into(), json!(it.path.is_closed()));
        o.insert("fill".into(), if it.path.is_closed() { self.fill(it, m, &bp) } else { Value::Null });
        o.insert("stroke".into(), self.stroke(it, scale));
        o.insert("path".into(), subpaths(&bp, m));
        match &it.content {
            Content::Graphic(g) => {
                if let Some(asset) = self.doc.assets.get(&g.asset)
                    && designcraft_doc::media_kind(&asset.mime).is_none()
                {
                    let id = g.asset.0.to_string();
                    if !self.assets.contains(&id) {
                        self.assets.push(id.clone());
                    }
                    let gm = m * g.xf;
                    let r = Rect::new(0.0, 0.0, g.size.0, g.size.1);
                    o.insert("image".into(), json!({ "asset": id, "box": boxed(gm, r), "name": asset.name }));
                } else {
                    self.skipped += 1;
                }
            }
            Content::Text(tf) => {
                if tf.options.path.is_some() {
                    self.skipped += 1;
                } else {
                    let cs = self.story(tf.story, page_name);
                    if let Some(ft) = cs.frame(it.id) {
                        let tm = m * self.doc.text_local(it);
                        let text = self.text(&cs, ft, tm, tf.story);
                        o.insert("text".into(), text);
                    }
                }
            }
            _ => {}
        }
        Some(Value::Object(o))
    }

    /// One text frame: shading and rules, tables, and its paragraphs.
    fn text(&mut self, cs: &ComposedStory, ft: &FrameText, m: Affine, sid: designcraft_doc::StoryId) -> Value {
        let Some(story) = self.doc.stories.get(&sid) else { return Value::Null };
        let mut decos = Vec::new();
        for d in &ft.decos {
            if let Some(color) = self.color(&d.color, d.tint) {
                decos.push(json!({ "box": boxed(m, d.rect), "color": color }));
            }
        }
        // Tables: cell fills, cell text and the cell edges.
        let mut cells = Vec::new();
        let mut rules = Vec::new();
        let mut cell_text = Vec::new();
        for t in &ft.tables {
            for c in &t.cells {
                if let Some((swatch, tint)) = &c.fill
                    && let Some(color) = self.color(swatch, *tint)
                {
                    cells.push(json!({ "box": boxed(m, c.rect), "color": color }));
                }
                if let Some(cft) = c.text.frames.first() {
                    let cm = m * Affine::translate(c.origin.to_vec2());
                    cell_text.extend(self.paragraphs(&c.text, cft, cm, &c.source, &|_| "left"));
                }
            }
            for seg in &t.strokes {
                if seg.stroke.weight <= 0.0 {
                    continue;
                }
                if let Some(color) = self.color(&seg.stroke.color, seg.stroke.tint) {
                    rules.push(json!({ "a": pt(m * seg.a), "b": pt(m * seg.b), "color": color, "weight": round(seg.stroke.weight * m.determinant().abs().sqrt()) }));
                }
            }
        }
        let doc = self.doc;
        let align = |para: usize| match story.paras.get(para).map(|p| doc.styles.resolve_para(p).0.align) {
            Some(designcraft_doc::Align::Center | designcraft_doc::Align::CenterJustified) => "center",
            Some(designcraft_doc::Align::Right | designcraft_doc::Align::RightJustified) => "right",
            // Justified text reads as left aligned once its lines are fixed.
            _ => "left",
        };
        let mut paragraphs = self.paragraphs(cs, ft, m, &story.text, &align);
        paragraphs.extend(cell_text);
        json!({ "paragraphs": paragraphs, "decos": decos, "cells": cells, "rules": rules })
    }

    /// Composed lines as text layers, each with its main style and position. `text` is the
    /// story the lines' byte ranges point into.
    fn paragraphs(&self, cs: &ComposedStory, ft: &FrameText, m: Affine, text: &str, align_of: &dyn Fn(usize) -> &'static str) -> Vec<Value> {
        let mut out = Vec::new();
        let mut i = 0;
        while i < ft.lines.len() {
            let mut j = i + 1;
            // One text layer per run of lines that sit evenly under each other: a new paragraph,
            // column, or a jump around a wrapped object starts the next.
            while j < ft.lines.len() {
                let (a, b) = (&ft.lines[j - 1], &ft.lines[j]);
                let step = b.baseline - a.baseline;
                let even = step > 0.0 && step <= a.leading.max(b.leading).max(1.0) * 1.3;
                if b.para != a.para || b.column != a.column || !even || (b.x0 - a.x0).abs() > 0.5 || (b.x1 - a.x1).abs() > 0.5 {
                    break;
                }
                j += 1;
            }
            let lines = &ft.lines[i..j];
            i = j;
            // DesignCraft's own line breaks are kept (Knuth–Plass composition, wrap around objects),
            // so the text sits exactly where it did; hyphens it added at line ends come along.
            // Special characters live in U+E000–E0FF: the page number becomes the page's number,
            // the rest (markers, anchors, breaks) go.
            let clean = |raw: &str| -> String {
                let mut out = String::new();
                for c in raw.chars() {
                    match c {
                        designcraft_doc::story::PAGE_NUMBER => out.push_str(&self.page_name),
                        '\u{e000}'..='\u{e0ff}' | '\u{feff}' | '\u{ad}' | '\u{200b}' => {}
                        '\u{2028}' | '\u{2029}' | '\r' | '\u{b}' | '\n' | '\t' => out.push(' '),
                        c if c.is_control() => {}
                        c => out.push(c),
                    }
                }
                out.trim_end().to_string()
            };
            let joined = lines
                .iter()
                .map(|l| {
                    let raw = text.get(l.range.start.min(text.len())..l.range.end.min(text.len())).unwrap_or("");
                    let mut line = clean(raw);
                    if l.hyphenated && !line.ends_with('-') {
                        line.push('-');
                    }
                    line
                })
                .collect::<Vec<_>>()
                .join("\n");
            if joined.trim().is_empty() {
                continue;
            }
            // The style most of the run's glyphs use.
            let mut counts: HashMap<(u32, String, u32, bool), usize> = HashMap::new();
            let mut sample = None;
            for l in lines {
                for g in l.glyphs.iter().filter(|g| g.visible && g.len > 0) {
                    let key = (g.style, g.face.family.clone(), g.face.weight as u32, g.face.italic);
                    *counts.entry(key).or_default() += 1;
                    sample.get_or_insert(g.face);
                }
            }
            let Some(((style, family, weight, italic), _)) = counts.into_iter().max_by_key(|(_, n)| *n) else { continue };
            let Some(rs) = cs.styles.get(style as usize) else { continue };
            let color = self.color(&rs.fill, rs.fill_tint).unwrap_or_else(|| "#000000".into());
            let size = rs.size;
            let first = &lines[0];
            let leading = if lines.len() > 1 { (lines[lines.len() - 1].baseline - first.baseline) / (lines.len() - 1) as f64 } else { first.leading.max(size) };
            let x0 = lines.iter().map(|l| l.x0).fold(f64::INFINITY, f64::min);
            let x1 = lines.iter().map(|l| l.x1).fold(f64::NEG_INFINITY, f64::max);
            let align = align_of(first.para);
            // Where Nagma's line box puts the baseline: half a line down plus half the font's
            // ascent minus descent.
            let face = sample.map(|f| ((f.ascent - f.descent.abs()) / f.upem.max(1.0)).clamp(0.2, 0.9)).unwrap_or(0.7);
            let top = first.baseline - leading / 2.0 - face * size / 2.0;
            let r = Rect::new(x0, top, x1.max(x0 + 1.0), top + leading * lines.len() as f64);
            let scale = m.determinant().abs().sqrt();
            out.push(json!({
                "text": joined,
                "box": boxed(m, r),
                "family": family,
                "weight": weight,
                "italic": italic,
                "size": round(size * scale),
                "lineHeight": round(leading / size.max(0.01)),
                "color": color,
                "align": align,
                "underline": rs.underline,
                "strikethrough": rs.strikethrough,
            }));
        }
        out
    }
}
