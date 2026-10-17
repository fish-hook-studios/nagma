//! A page's drawing content as editable pieces: text runs, vector paths and images, in paint
//! order and page view space (points, origin at the top-left of the displayed page, y down).
//!
//! The content is interpreted with hayro's interpreter into a device that records instead of
//! painting. Glyphs that map to Unicode become text runs (consecutive glyphs of one style on one
//! baseline); glyphs without Unicode (icon fonts, Type3 drawings) become vector outlines. Paths keep
//! their fill (solid or axial/radial gradient), fill rule and stroke. Images are decoded to RGBA
//! with their placement. Clip paths that cut into something are reported with it.

use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;

use hayro::hayro_interpret::font::Glyph;
use hayro::hayro_interpret::hayro_syntax::Pdf;
use hayro::hayro_interpret::hayro_syntax::object::{Array, Dict, Name, Stream};
use hayro::hayro_interpret::hayro_syntax::page::Resources;
use hayro::hayro_interpret::pattern::Pattern;
use hayro::hayro_interpret::shading::ShadingType;
use hayro::hayro_interpret::{
    BlendMode, CacheKey, ClipPath, Context, Device, FillRule, GlyphDrawMode, Image, ImageData, InterpreterCache, InterpreterSettings, LumaData,
    Paint, PathDrawMode, SoftMask, TransformExt, interpret_page,
};
use kurbo::{Affine, BezPath, Cap, Join, PathEl, Point, Rect, Shape, Vec2};
use serde_json::{Value, json};
use smallvec::smallvec;

/// What a font is, read from its dictionary.
#[derive(Clone, Debug, Default)]
struct FontMeta {
    name: String,
    family: Option<String>,
    weight: Option<u32>,
    italic: bool,
    serif: bool,
    fixed: bool,
    bold: bool,
}

const FLAG_FIXED: u32 = 1;
const FLAG_SERIF: u32 = 1 << 1;
const FLAG_ITALIC: u32 = 1 << 6;
const FLAG_FORCE_BOLD: u32 = 1 << 18;

fn strip_subset(name: &str) -> &str {
    match name.split_once('+') {
        Some((p, rest)) if p.len() == 6 && p.bytes().all(|b| b.is_ascii_uppercase()) => rest,
        _ => name,
    }
}

fn font_meta(font: &Dict<'_>) -> FontMeta {
    let name = font.get::<Name<'_>>(b"BaseFont".as_slice()).map(|n| strip_subset(n.as_str()).to_string()).unwrap_or_default();
    let descendant = font.get::<Array<'_>>(b"DescendantFonts".as_slice()).and_then(|a| a.iter::<Dict<'_>>().next());
    let descriptor = font
        .get::<Dict<'_>>(b"FontDescriptor".as_slice())
        .or_else(|| descendant.as_ref().and_then(|d| d.get::<Dict<'_>>(b"FontDescriptor".as_slice())));
    let mut meta = FontMeta { name, ..Default::default() };
    if let Some(d) = descriptor {
        let flags = d.get::<u32>(b"Flags".as_slice()).unwrap_or(0);
        meta.fixed = flags & FLAG_FIXED != 0;
        meta.serif = flags & FLAG_SERIF != 0;
        meta.italic = flags & FLAG_ITALIC != 0 || d.get::<f32>(b"ItalicAngle".as_slice()).is_some_and(|a| a.abs() > 3.0);
        meta.bold = flags & FLAG_FORCE_BOLD != 0;
        meta.weight = d.get::<f32>(b"FontWeight".as_slice()).map(|w| w as u32).filter(|w| (100..=1000).contains(w));
        meta.family = d.get::<hayro::hayro_interpret::hayro_syntax::object::String<'_>>(b"FontFamily".as_slice()).and_then(|s| {
            let bytes: &[u8] = s.as_ref();
            std::str::from_utf8(bytes).ok().map(|s| s.to_string()).filter(|s| !s.is_empty())
        });
        if meta.name.is_empty() {
            meta.name = d.get::<Name<'_>>(b"FontName".as_slice()).map(|n| strip_subset(n.as_str()).to_string()).unwrap_or_default();
        }
    }
    meta
}

/// Every font the page can reach (its resources, form XObjects, tiling patterns, Type3 glyph
/// procedures and annotation appearances), by the key hayro gives the font.
fn scan_fonts(page: &hayro::hayro_interpret::hayro_syntax::page::Page<'_>) -> HashMap<u128, FontMeta> {
    let mut out = HashMap::new();
    let mut seen = HashSet::new();
    let mut res: Option<&Resources<'_>> = Some(page.resources());
    while let Some(r) = res {
        scan_dicts(&r.fonts, &r.x_objects, &r.patterns, &mut out, &mut seen, 0);
        res = r.parent();
    }
    if let Some(annots) = page.raw().get::<Array<'_>>(b"Annots".as_slice()) {
        for annot in annots.iter::<Dict<'_>>() {
            let Some(ap) = annot.get::<Dict<'_>>(b"AP".as_slice()) else { continue };
            let mut streams: Vec<Stream<'_>> = Vec::new();
            if let Some(s) = ap.get::<Stream<'_>>(b"N".as_slice()) {
                streams.push(s);
            } else if let Some(states) = ap.get::<Dict<'_>>(b"N".as_slice()) {
                for k in states.keys() {
                    if let Some(s) = states.get::<Stream<'_>>(k.as_ref()) {
                        streams.push(s);
                    }
                }
            }
            for s in streams {
                scan_resources(&s.dict().get::<Dict<'_>>(b"Resources".as_slice()).unwrap_or_default(), &mut out, &mut seen, 1);
            }
        }
    }
    out
}

fn scan_resources(res: &Dict<'_>, out: &mut HashMap<u128, FontMeta>, seen: &mut HashSet<usize>, depth: u32) {
    if depth > 12 || res.is_empty() || !seen.insert(res.data().as_ptr() as usize) {
        return;
    }
    let get = |k: &[u8]| res.get::<Dict<'_>>(k).unwrap_or_default();
    scan_dicts(&get(b"Font"), &get(b"XObject"), &get(b"Pattern"), out, seen, depth);
}

fn scan_dicts(fonts: &Dict<'_>, xobjects: &Dict<'_>, patterns: &Dict<'_>, out: &mut HashMap<u128, FontMeta>, seen: &mut HashSet<usize>, depth: u32) {
    for k in fonts.keys() {
        let Some(font) = fonts.get::<Dict<'_>>(k.as_ref()) else { continue };
        out.entry(font.cache_key()).or_insert_with(|| font_meta(&font));
        if let Some(r) = font.get::<Dict<'_>>(b"Resources".as_slice()) {
            scan_resources(&r, out, seen, depth + 1);
        }
    }
    for dict in [xobjects, patterns] {
        for k in dict.keys() {
            if let Some(s) = dict.get::<Stream<'_>>(k.as_ref())
                && let Some(r) = s.dict().get::<Dict<'_>>(b"Resources".as_slice())
            {
                scan_resources(&r, out, seen, depth + 1);
            }
        }
    }
}

/// Decoded RGBA pixels of one image.
pub struct Rgba {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

#[derive(Clone)]
enum Fill {
    Solid([f32; 4]),
    Gradient(Value),
}

#[derive(Clone)]
struct StrokeStyle {
    color: Fill,
    width: f32,
    cap: &'static str,
    join: &'static str,
    dash: Vec<f32>,
}

struct PathItem {
    d: String,
    bbox: Rect,
    rect: Option<Rect>,
    fill: Option<Fill>,
    even_odd: bool,
    stroke: Option<StrokeStyle>,
    opacity: f32,
    blend: BlendMode,
    clip: Option<usize>,
    /// Outlines of glyphs without Unicode, so neighbours of the same paint join into one shape.
    glyphs: bool,
}

struct ImageItem {
    image: usize,
    m: Affine,
    opacity: f32,
    blend: BlendMode,
    clip: Option<usize>,
}

struct GlyphPos {
    text: String,
    /// Offset of the glyph's origin along the baseline from the run's origin, and its advance.
    at: f64,
    adv: f64,
}

struct Run {
    font: u128,
    size: f64,
    color: [f32; 4],
    stroke: Option<([f32; 4], f32)>,
    origin: Point,
    dir: Vec2,
    hscale: f64,
    opacity: f32,
    blend: BlendMode,
    glyphs: Vec<GlyphPos>,
    open: bool,
}

enum Item {
    Path(PathItem),
    Image(ImageItem),
    Text(Run),
}

struct ClipEntry {
    id: usize,
    rect: Option<Rect>,
    bbox: Rect,
}

struct Dev {
    items: Vec<Item>,
    clip_stack: Vec<ClipEntry>,
    clips: Vec<(String, bool)>,
    used_clips: HashSet<usize>,
    groups: Vec<f32>,
    blend: BlendMode,
    images: Vec<Rgba>,
    image_keys: HashMap<u128, usize>,
    /// Index of the run that the next glyph may continue.
    current: Option<usize>,
    /// Tiling patterns: only the first solid colour drawn inside is wanted.
    sample: Option<Option<[f32; 4]>>,
    page: Rect,
}

fn f(v: f64) -> String {
    let r = (v * 100.0).round() / 100.0;
    if r == r.trunc() { format!("{}", r as i64) } else { format!("{r}") }
}

fn path_d(path: &BezPath) -> String {
    let mut s = String::new();
    let mut last = Point::ZERO;
    for el in path.elements() {
        match *el {
            PathEl::MoveTo(p) => {
                let _ = write!(s, "M{} {}", f(p.x), f(p.y));
                last = p;
            }
            PathEl::LineTo(p) => {
                let _ = write!(s, "L{} {}", f(p.x), f(p.y));
                last = p;
            }
            PathEl::QuadTo(c, p) => {
                let c1 = last + (c - last) * (2.0 / 3.0);
                let c2 = p + (c - p) * (2.0 / 3.0);
                let _ = write!(s, "C{} {} {} {} {} {}", f(c1.x), f(c1.y), f(c2.x), f(c2.y), f(p.x), f(p.y));
                last = p;
            }
            PathEl::CurveTo(a, b, p) => {
                let _ = write!(s, "C{} {} {} {} {} {}", f(a.x), f(a.y), f(b.x), f(b.y), f(p.x), f(p.y));
                last = p;
            }
            PathEl::ClosePath => s.push('Z'),
        }
    }
    s
}

/// The rectangle a path traces, if it is one (axis-aligned, one subpath).
fn as_rect(path: &BezPath) -> Option<Rect> {
    let mut pts = Vec::new();
    let mut moves = 0;
    for el in path.elements() {
        match *el {
            PathEl::MoveTo(p) => {
                moves += 1;
                pts.push(p);
            }
            PathEl::LineTo(p) => pts.push(p),
            PathEl::ClosePath => {}
            _ => return None,
        }
    }
    if moves != 1 {
        return None;
    }
    if pts.len() == 5 && (pts[4] - pts[0]).hypot() < 0.01 {
        pts.pop();
    }
    if pts.len() != 4 {
        return None;
    }
    let eq = |a: f64, b: f64| (a - b).abs() < 0.01;
    let ok = (0..4).all(|i| {
        let (a, b) = (pts[i], pts[(i + 1) % 4]);
        eq(a.x, b.x) || eq(a.y, b.y)
    });
    if !ok {
        return None;
    }
    let r = Rect::from_points(pts[0], pts[2]);
    (r.width() > 0.0 && r.height() > 0.0).then_some(r)
}

fn contains(outer: Rect, inner: Rect, tol: f64) -> bool {
    inner.x0 >= outer.x0 - tol && inner.y0 >= outer.y0 - tol && inner.x1 <= outer.x1 + tol && inner.y1 <= outer.y1 + tol
}

fn overlaps(a: Rect, b: Rect) -> bool {
    a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
}

fn blend_name(b: BlendMode) -> &'static str {
    match b {
        BlendMode::Normal => "normal",
        BlendMode::Multiply => "multiply",
        BlendMode::Screen => "screen",
        BlendMode::Overlay => "overlay",
        BlendMode::Darken => "darken",
        BlendMode::Lighten => "lighten",
        BlendMode::ColorDodge => "color-dodge",
        BlendMode::ColorBurn => "color-burn",
        BlendMode::HardLight => "hard-light",
        BlendMode::SoftLight => "soft-light",
        BlendMode::Difference => "difference",
        BlendMode::Exclusion => "exclusion",
        BlendMode::Hue => "hue",
        BlendMode::Saturation => "saturation",
        BlendMode::Color => "color",
        BlendMode::Luminosity => "luminosity",
    }
}

fn rgba_json(c: [f32; 4]) -> Value {
    let r = |v: f32| ((v.clamp(0.0, 1.0) * 1000.0).round() / 1000.0) as f64;
    json!([r(c[0]), r(c[1]), r(c[2]), r(c[3])])
}

fn fill_json(f: &Fill) -> Value {
    match f {
        Fill::Solid(c) => json!({ "solid": rgba_json(*c) }),
        Fill::Gradient(g) => g.clone(),
    }
}

impl Dev {
    fn opacity(&self) -> f32 {
        self.groups.iter().product()
    }

    /// The clip that applies to something covering `bbox`: `Err` when it is clipped away
    /// entirely, `Ok(None)` when no clip cuts into it.
    fn clip_for(&self, bbox: Rect) -> Result<Option<usize>, ()> {
        let mut best: Option<&ClipEntry> = None;
        for c in &self.clip_stack {
            if !overlaps(c.bbox.inflate(0.5, 0.5), bbox) {
                return Err(());
            }
            if c.rect.is_some_and(|r| contains(r, bbox, 0.75)) {
                continue;
            }
            if best.is_none_or(|b| c.bbox.area() < b.bbox.area()) {
                best = Some(c);
            }
        }
        Ok(best.map(|c| c.id))
    }

    fn close_runs_under(&mut self, bbox: Rect) {
        if let Some(i) = self.current
            && let Some(Item::Text(run)) = self.items.get_mut(i)
            && overlaps(run_bbox(run), bbox)
        {
            run.open = false;
            self.current = None;
        }
    }

    fn paint_fill(&mut self, paint: &Paint<'_>, bbox: Rect) -> Option<Fill> {
        match paint {
            Paint::Color(c) => Some(Fill::Solid(c.to_rgba().components())),
            Paint::Pattern(p) => match &**p {
                Pattern::Shading(sp) => {
                    let shading = &sp.shading;
                    let cs = &shading.color_space;
                    let color = |v: &[f32]| cs.to_rgba(v, sp.opacity, false).components();
                    match &*shading.shading_type {
                        ShadingType::RadialAxial { coords, domain, function, axial, .. } => {
                            let n = 9;
                            let mut stops = Vec::new();
                            for i in 0..n {
                                let t = i as f32 / (n - 1) as f32;
                                let x = domain[0] + t * (domain[1] - domain[0]);
                                if let Some(v) = function.eval(&smallvec![x]) {
                                    stops.push(json!([t, rgba_json(color(&v))]));
                                }
                            }
                            if stops.is_empty() {
                                return None;
                            }
                            let m = sp.matrix;
                            let p0 = m * Point::new(coords[0] as f64, coords[1] as f64);
                            if *axial {
                                let p1 = m * Point::new(coords[2] as f64, coords[3] as f64);
                                Some(Fill::Gradient(json!({ "type": "linear", "from": [p0.x, p0.y], "to": [p1.x, p1.y], "stops": stops })))
                            } else {
                                let c1 = m * Point::new(coords[3] as f64, coords[4] as f64);
                                let scale = (m.determinant().abs()).sqrt();
                                let r1 = coords[5] as f64 * scale;
                                Some(Fill::Gradient(json!({ "type": "radial", "from": [c1.x, c1.y], "to": [c1.x + r1, c1.y], "r0": coords[2] as f64 * scale, "stops": stops })))
                            }
                        }
                        ShadingType::FunctionBased { domain, function, .. } => {
                            let x = (domain[0] + domain[1]) / 2.0;
                            let y = (domain[2] + domain[3]) / 2.0;
                            function.eval(&smallvec![x, y]).map(|v| Fill::Solid(color(&v)))
                        }
                        ShadingType::TriangleMesh { triangles, function } => {
                            let t = triangles.first()?;
                            let v = match function {
                                Some(func) => func.eval(&t.p0.colors)?,
                                None => t.p0.colors.clone(),
                            };
                            Some(Fill::Solid(color(&v)))
                        }
                        ShadingType::CoonsPatchMesh { patches, function } => {
                            let p = patches.first()?;
                            let v = match function {
                                Some(func) => func.eval(&p.colors[0])?,
                                None => p.colors[0].clone(),
                            };
                            Some(Fill::Solid(color(&v)))
                        }
                        ShadingType::TensorProductPatchMesh { patches, function } => {
                            let p = patches.first()?;
                            let v = match function {
                                Some(func) => func.eval(&p.colors[0])?,
                                None => p.colors[0].clone(),
                            };
                            Some(Fill::Solid(color(&v)))
                        }
                        ShadingType::Dummy => None,
                    }
                }
                Pattern::Tiling(t) => {
                    // The first colour the tile paints stands in for the pattern.
                    let mut sub = Dev::new(self.page);
                    sub.sample = Some(None);
                    let _ = t.interpret(&mut sub, Affine::translate((bbox.x0, bbox.y0)), false);
                    sub.sample.flatten().map(Fill::Solid)
                }
            },
        }
    }

    fn new(page: Rect) -> Self {
        Dev {
            items: Vec::new(),
            clip_stack: Vec::new(),
            clips: Vec::new(),
            used_clips: HashSet::new(),
            groups: Vec::new(),
            blend: BlendMode::Normal,
            images: Vec::new(),
            image_keys: HashMap::new(),
            current: None,
            sample: None,
            page,
        }
    }

    fn add_path(&mut self, path: BezPath, paint: &Paint<'_>, mode: &PathDrawMode, transform: Affine, glyphs: bool) {
        let device = transform * path;
        let mut bbox = device.bounding_box();
        if !(bbox.x0.is_finite() && bbox.y0.is_finite() && bbox.x1.is_finite() && bbox.y1.is_finite()) {
            return;
        }
        let scale = transform.determinant().abs().sqrt();
        let stroke_props = match mode {
            PathDrawMode::Stroke(s) => Some(s.clone()),
            PathDrawMode::Fill(_) => None,
        };
        if let Some(s) = &stroke_props {
            let half = (s.line_width as f64 * scale / 2.0).max(0.25);
            bbox = bbox.inflate(half, half);
        }
        if let Some(sample) = &mut self.sample {
            if sample.is_none()
                && let Paint::Color(c) = paint
            {
                *sample = Some(c.to_rgba().components());
            }
            return;
        }
        let Ok(mut clip) = self.clip_for(bbox) else { return };
        let Some(color) = self.paint_fill(paint, bbox) else { return };
        let opacity = self.opacity();
        let blend = self.blend;
        let mut d = path_d(&device);
        let mut rect = as_rect(&device);
        let mut even_odd = matches!(mode, PathDrawMode::Fill(FillRule::EvenOdd));
        // A shape painted over its clip (a shading, or a rectangle under a clipping path) is the
        // clip's shape.
        if let (None, Some(r), Some(c)) = (&stroke_props, rect, clip)
            && let Some(entry) = self.clip_stack.iter().find(|e| e.id == c)
            && contains(r, entry.bbox, 0.75)
        {
            let (cd, ceo) = self.clips[c].clone();
            d = cd;
            even_odd = ceo;
            bbox = entry.bbox;
            rect = entry.rect;
            clip = None;
            // Clips further out may still cut into the new shape.
            if let Ok(outer) = self.clip_for(bbox) {
                clip = outer.filter(|o| *o != c);
            }
        }
        if let Some(c) = clip {
            self.used_clips.insert(c);
        }
        self.close_runs_under(bbox);
        if let Some(s) = stroke_props {
            let stroke = StrokeStyle {
                color,
                width: (s.line_width as f64 * scale).max(0.1) as f32,
                cap: match s.line_cap {
                    Cap::Butt => "butt",
                    Cap::Round => "round",
                    Cap::Square => "square",
                },
                join: match s.line_join {
                    Join::Miter => "miter",
                    Join::Round => "round",
                    Join::Bevel => "bevel",
                },
                dash: s.dash_array.iter().map(|v| (*v as f64 * scale) as f32).collect(),
            };
            // Fill then stroke of the same path (`B`) is one shape.
            if let Some(Item::Path(last)) = self.items.last_mut()
                && last.stroke.is_none()
                && last.d == d
                && last.clip == clip
                && (last.opacity - opacity).abs() < 1e-3
            {
                last.stroke = Some(stroke);
                last.bbox = last.bbox.union(bbox);
                return;
            }
            self.items.push(Item::Path(PathItem { d, bbox, rect, fill: None, even_odd: false, stroke: Some(stroke), opacity, blend, clip, glyphs }));
            return;
        }
        if glyphs
            && let Some(Item::Path(last)) = self.items.last_mut()
            && last.glyphs
            && last.clip == clip
            && last.stroke.is_none()
            && (last.opacity - opacity).abs() < 1e-3
            && matches!((&last.fill, &color), (Some(Fill::Solid(a)), Fill::Solid(b)) if a == b)
            && overlaps(last.bbox.inflate(last.bbox.height().max(4.0), 2.0), bbox)
        {
            last.d.push_str(&d);
            last.bbox = last.bbox.union(bbox);
            last.rect = None;
            return;
        }
        self.items.push(Item::Path(PathItem { d, bbox, rect, fill: Some(color), even_odd, stroke: None, opacity, blend, clip, glyphs }));
    }

    fn add_glyph<'a>(&mut self, glyph: &Glyph<'a>, transform: Affine, glyph_transform: Affine, paint: &Paint<'a>, mode: &GlyphDrawMode) {
        if matches!(mode, GlyphDrawMode::Invisible) {
            return;
        }
        let t = transform * glyph_transform;
        let [a, b, c, d, _, _] = t.as_coeffs();
        let text = glyph.as_unicode().map(|u| match u {
            hayro::hayro_interpret::hayro_cmap::BfString::Char(c) => c.to_string(),
            hayro::hayro_interpret::hayro_cmap::BfString::String(s) => s,
        });
        let vertical = matches!(glyph, Glyph::Outline(g) if g.is_vertical());
        // Mirrored or vertical text, private-use characters (icon fonts) and glyphs with no
        // Unicode keep their drawn shapes.
        let usable = text.as_ref().filter(|s| {
            !s.is_empty() && !s.chars().all(|c| c.is_control()) && !s.chars().any(|c| ('\u{E000}'..='\u{F8FF}').contains(&c) || c == '\u{FFFD}')
        });
        let mirrored = a * d - b * c > 0.0;
        if usable.is_none() || mirrored || vertical || self.sample.is_some() {
            if self.sample.is_some() && !matches!(paint, Paint::Color(_)) {
                return;
            }
            match glyph {
                Glyph::Outline(g) => {
                    if text.as_ref().is_some_and(|s| s.chars().all(char::is_whitespace)) {
                        return;
                    }
                    let outline = g.outline();
                    if outline.elements().is_empty() {
                        return;
                    }
                    let draw = match mode {
                        GlyphDrawMode::Stroke(s) => PathDrawMode::Stroke(s.clone()),
                        _ => PathDrawMode::Fill(FillRule::NonZero),
                    };
                    self.add_path(outline, paint, &draw, t, true);
                }
                Glyph::Type3(g) => {
                    self.current = None;
                    g.interpret(self, transform, glyph_transform, paint);
                }
            }
            return;
        }
        let Some(text) = usable.cloned() else { return };
        let origin = t * Point::ZERO;
        let x_axis = Vec2::new(a, b);
        let y_axis = Vec2::new(c, d);
        let size = y_axis.hypot() * 1000.0;
        if !(size.is_finite() && size > 0.05 && origin.x.is_finite() && origin.y.is_finite()) || size > 5000.0 {
            return;
        }
        let dir = if x_axis.hypot() > 0.0 { x_axis / x_axis.hypot() } else { Vec2::new(1.0, 0.0) };
        let hscale = x_axis.hypot() / y_axis.hypot();
        let adv_units = match glyph {
            Glyph::Outline(g) => g.advance_width().filter(|a| *a > 0.0).map(f64::from).unwrap_or_else(|| g.outline().bounding_box().width().max(250.0)),
            Glyph::Type3(g) => g.advance_width().filter(|a| a.is_finite() && *a > 0.0).map(f64::from).unwrap_or(500.0),
        };
        let adv = adv_units * x_axis.hypot();
        let (color, stroke) = match (mode, paint) {
            (GlyphDrawMode::Stroke(s), Paint::Color(c)) => ([0.0, 0.0, 0.0, 0.0], Some((c.to_rgba().components(), (s.line_width as f64 * transform.determinant().abs().sqrt()) as f32))),
            (_, Paint::Color(c)) => (c.to_rgba().components(), None),
            (_, p) => match self.paint_fill(p, Rect::from_origin_size(origin, (adv, size))) {
                Some(Fill::Solid(c)) => (c, None),
                Some(Fill::Gradient(g)) => {
                    let s = &g["stops"][0][1];
                    let v = |i: usize| s[i].as_f64().unwrap_or(0.0) as f32;
                    ([v(0), v(1), v(2), v(3)], None)
                }
                None => ([0.0, 0.0, 0.0, 1.0], None),
            },
        };
        let font = match glyph {
            Glyph::Outline(g) => g.font_cache_key(),
            Glyph::Type3(_) => 1,
        };
        let opacity = self.opacity();
        let blend = self.blend;
        let gbox = Rect::from_points(origin - y_axis * 800.0, origin + x_axis * adv_units + y_axis * 200.0);
        let Ok(_) = self.clip_for(gbox) else {
            return;
        };

        if let Some(i) = self.current
            && let Some(Item::Text(run)) = self.items.get_mut(i)
            && run.open
            && run.font == font
            && (run.size - size).abs() < size * 0.01
            && run.color == color
            && run.stroke == stroke
            && (run.hscale - hscale).abs() < 0.01
            && (run.dir - dir).hypot() < 0.002
            && (run.opacity - opacity).abs() < 1e-3
            && run.blend == blend
        {
            let rel = origin - run.origin;
            let along = rel.dot(run.dir);
            let across = rel.cross(run.dir).abs();
            let end = run.glyphs.last().map_or(0.0, |g| g.at + g.adv);
            let gap = along - end;
            if across < size * 0.08 && gap > -size * 0.6 && gap < size * 4.0 {
                // Fake bold: the same glyph drawn again a hair to the side.
                if let Some(last) = run.glyphs.last()
                    && last.text == text
                    && (along - last.at).abs() < size * 0.1
                    && along >= last.at - size * 0.01
                    && gap < 0.0
                {
                    return;
                }
                run.glyphs.push(GlyphPos { text, at: along, adv });
                return;
            }
        }
        if let Some(i) = self.current
            && let Some(Item::Text(run)) = self.items.get_mut(i)
        {
            run.open = false;
        }
        self.items.push(Item::Text(Run {
            font,
            size,
            color,
            stroke,
            origin,
            dir,
            hscale,
            opacity,
            blend,
            glyphs: vec![GlyphPos { text, at: 0.0, adv }],
            open: true,
        }));
        self.current = Some(self.items.len() - 1);
    }

    fn add_image(&mut self, image: Image<'_, '_>, transform: Affine) {
        let (w, h) = (image.width(), image.height());
        if w == 0 || h == 0 {
            return;
        }
        let tw = (transform * Point::new(w as f64, 0.0) - transform * Point::ZERO).hypot();
        let th = (transform * Point::new(0.0, h as f64) - transform * Point::ZERO).hypot();
        let unit = transform * Affine::scale_non_uniform(w as f64, h as f64);
        let bbox = (unit * Rect::new(0.0, 0.0, 1.0, 1.0).to_path(0.1)).bounding_box();
        if self.sample.is_some() {
            return;
        }
        let Ok(clip) = self.clip_for(bbox) else { return };
        // Decode at up to three pixels per point, never above the image's own size.
        let target = (((tw * 3.0).ceil() as u32).clamp(1, w), ((th * 3.0).ceil() as u32).clamp(1, h));
        let opacity = self.opacity();
        let blend = self.blend;
        let (key, rgba) = match image {
            Image::Raster(r) => {
                let key = r.cache_key();
                if let Some(&i) = self.image_keys.get(&key) {
                    (key, Err(i))
                } else {
                    let mut out = None;
                    r.with_rgba(|data, alpha| out = Some(to_rgba(&data, alpha.as_ref(), None)), Some(target));
                    (key, Ok(out))
                }
            }
            Image::Stencil(s) => {
                let mut out = None;
                let mut color_key = 0u128;
                s.with_stencil(
                    |luma, paint| {
                        let color = match paint {
                            Paint::Color(c) => c.to_rgba().components(),
                            Paint::Pattern(_) => [0.5, 0.5, 0.5, 1.0],
                        };
                        color_key = u128::from_le_bytes({
                            let mut b = [0u8; 16];
                            for (i, c) in color.iter().enumerate() {
                                b[i * 4..i * 4 + 4].copy_from_slice(&c.to_le_bytes());
                            }
                            b
                        });
                        out = Some(to_rgba(&ImageData::Luma(luma.clone()), Some(&luma), Some(color)));
                    },
                    Some(target),
                );
                let key = s.cache_key() ^ color_key.rotate_left(17);
                match self.image_keys.get(&key) {
                    Some(&i) => (key, Err(i)),
                    None => (key, Ok(out)),
                }
            }
        };
        let index = match rgba {
            Err(i) => i,
            Ok(Some(img)) => {
                self.images.push(img);
                self.image_keys.insert(key, self.images.len() - 1);
                self.images.len() - 1
            }
            Ok(None) => return,
        };
        if let Some(c) = clip {
            self.used_clips.insert(c);
        }
        self.close_runs_under(bbox);
        self.items.push(Item::Image(ImageItem { image: index, m: unit, opacity, blend, clip }));
    }
}

/// RGBA from decoded image data, with its alpha (resampled to the image's size when it differs).
/// `tint`: a stencil mask, painted in that colour where the mask is set.
fn to_rgba(data: &ImageData, alpha: Option<&LumaData>, tint: Option<[f32; 4]>) -> Rgba {
    let (w, h) = (data.width(), data.height());
    let n = (w as usize) * (h as usize);
    let mut out = vec![255u8; n * 4];
    match (data, tint) {
        (_, Some(c)) => {
            let rgb = [c[0], c[1], c[2]].map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8);
            for px in out.chunks_exact_mut(4) {
                px[..3].copy_from_slice(&rgb);
            }
        }
        (ImageData::Rgb(d), None) => {
            for (px, src) in out.chunks_exact_mut(4).zip(d.data.chunks_exact(3)) {
                px[..3].copy_from_slice(src);
            }
        }
        (ImageData::Luma(d), None) => {
            for (px, v) in out.chunks_exact_mut(4).zip(d.data.iter()) {
                px[0] = *v;
                px[1] = *v;
                px[2] = *v;
            }
        }
    }
    if let Some(a) = alpha {
        let scale = tint.map_or(1.0, |c| c[3].clamp(0.0, 1.0));
        let (aw, ah) = (a.width as usize, a.height as usize);
        if aw > 0 && ah > 0 && a.data.len() >= aw * ah {
            for y in 0..h as usize {
                let ay = (y * ah / h as usize).min(ah - 1);
                for x in 0..w as usize {
                    let ax = (x * aw / w as usize).min(aw - 1);
                    out[(y * w as usize + x) * 4 + 3] = (a.data[ay * aw + ax] as f32 * scale).round() as u8;
                }
            }
        }
    }
    Rgba { width: w, height: h, data: out }
}

fn run_bbox(run: &Run) -> Rect {
    let end = run.glyphs.last().map_or(0.0, |g| g.at + g.adv);
    let up = Vec2::new(run.dir.y, -run.dir.x);
    let a = run.origin + up * (run.size * 0.8);
    let b = run.origin + run.dir * end - up * (run.size * 0.2);
    Rect::from_points(a, b).union(Rect::from_points(run.origin + run.dir * end + up * (run.size * 0.8), run.origin - up * (run.size * 0.2)))
}

impl<'a> Device<'a> for Dev {
    fn set_soft_mask(&mut self, _: Option<SoftMask<'a>>) {}
    fn set_blend_mode(&mut self, blend_mode: BlendMode) {
        self.blend = blend_mode;
    }
    fn draw_path(&mut self, path: &BezPath, transform: Affine, paint: &Paint<'a>, draw_mode: &PathDrawMode) {
        self.add_path(path.clone(), paint, draw_mode, transform, false);
    }
    fn push_clip_path(&mut self, clip_path: &ClipPath) {
        let bbox = clip_path.path.bounding_box();
        let id = self.clips.len();
        self.clips.push((path_d(&clip_path.path), clip_path.fill == FillRule::EvenOdd));
        let rect = as_rect(&clip_path.path);
        self.clip_stack.push(ClipEntry { id, rect, bbox });
    }
    fn push_transparency_group(&mut self, opacity: f32, _: Option<SoftMask<'a>>, _: BlendMode) {
        self.groups.push(opacity);
    }
    fn draw_glyph(&mut self, glyph: &Glyph<'a>, transform: Affine, glyph_transform: Affine, paint: &Paint<'a>, draw_mode: &GlyphDrawMode) {
        self.add_glyph(glyph, transform, glyph_transform, paint, draw_mode);
    }
    fn draw_image(&mut self, image: Image<'a, '_>, transform: Affine) {
        self.add_image(image, transform);
    }
    fn pop_clip_path(&mut self) {
        self.clip_stack.pop();
    }
    fn pop_transparency_group(&mut self) {
        self.groups.pop();
    }
}

/// A run's glyphs as text pieces: spaces where the gap between glyphs is a word space, and a new
/// piece where it is wider (table cells, columns). Returns (text, start offset, end offset).
fn split_run(run: &Run) -> Vec<(String, f64, f64, f64)> {
    let size = run.size;
    let gaps: Vec<f64> = run.glyphs.windows(2).map(|w| w[1].at - (w[0].at + w[0].adv)).collect();
    // Tracking: the usual gap between letters, when it is consistent.
    let mut sorted: Vec<f64> = gaps.iter().copied().filter(|g| g.abs() < size * 0.5).collect();
    sorted.sort_by(f64::total_cmp);
    let tracking = if sorted.len() >= 3 { sorted[sorted.len() / 2].clamp(-size * 0.2, size * 0.4) } else { 0.0 };
    let tracking = if tracking.abs() < size * 0.01 { 0.0 } else { tracking };
    // The usual word space on this run; a gap well beyond it (a tab after a bullet, table
    // cells) starts a new piece, as does any gap wider than an em.
    let mut words: Vec<f64> = gaps.iter().map(|g| g - tracking).filter(|g| *g > size * 0.17 && *g < size * 0.9).collect();
    words.sort_by(f64::total_cmp);
    let word = if words.len() >= 3 { words[words.len() / 2] } else { size * 0.25 };
    // Pieces of glyph indices; a wide gap starts a new piece.
    let mut pieces: Vec<Vec<(usize, bool)>> = vec![Vec::new()];
    for i in 0..run.glyphs.len() {
        let mut space_before = false;
        if i > 0 {
            let gap = gaps[i - 1] - tracking;
            // A wide space character (a tab drawn as a space) splits like a gap.
            let prev = &run.glyphs[i - 1];
            let wide_space = prev.text.chars().all(char::is_whitespace) && prev.adv > size * 0.6;
            if wide_space || gap > size * 0.9 || (gap > size * 0.45 && gap > word * 1.8) {
                pieces.push(Vec::new());
            } else if gap > size * 0.17 {
                space_before = true;
            }
        }
        if let Some(p) = pieces.last_mut() {
            p.push((i, space_before));
        }
    }
    let mut out = Vec::new();
    for piece in pieces {
        let blank = |i: usize| run.glyphs[i].text.chars().all(char::is_whitespace);
        let Some(first) = piece.iter().position(|(i, _)| !blank(*i)) else { continue };
        let last = piece.iter().rposition(|(i, _)| !blank(*i)).unwrap_or(first);
        let mut text = String::new();
        for (k, (i, space_before)) in piece[first..=last].iter().enumerate() {
            if k > 0 && *space_before && !text.ends_with(' ') && !run.glyphs[*i].text.starts_with(' ') {
                text.push(' ');
            }
            text.push_str(&run.glyphs[*i].text);
        }
        let (gi, gl) = (piece[first].0, piece[last].0);
        out.push((text, run.glyphs[gi].at, run.glyphs[gl].at + run.glyphs[gl].adv, tracking));
    }
    out
}

/// Extracts one page. JSON plus the decoded images it refers to by index.
pub fn extract(pdf: &Pdf, page: usize, settings: &InterpreterSettings) -> Option<(String, Vec<Rgba>)> {
    let pages = pdf.pages();
    let p = pages.get(page)?;
    let (w, h) = p.render_dimensions();
    let fonts_meta = scan_fonts(p);
    let cache = InterpreterCache::new();
    let initial = p.initial_transform(true).to_kurbo();
    let page_rect = Rect::new(0.0, 0.0, w as f64, h as f64);
    let mut ctx = Context::new(initial, page_rect, &cache, p.xref(), settings.clone());
    let mut dev = Dev::new(page_rect);
    interpret_page(p, &mut ctx, &mut dev);

    let mut fonts: Vec<u128> = Vec::new();
    let font_index = |k: u128, fonts: &mut Vec<u128>| match fonts.iter().position(|f| *f == k) {
        Some(i) => i,
        None => {
            fonts.push(k);
            fonts.len() - 1
        }
    };
    let mut clip_ids: HashMap<usize, usize> = HashMap::new();
    let mut clips_out = Vec::new();
    let mut clip_ref = |c: Option<usize>, dev: &Dev| -> Value {
        match c {
            None => Value::Null,
            Some(c) => {
                let next = clips_out.len();
                let i = *clip_ids.entry(c).or_insert_with(|| {
                    let (d, eo) = &dev.clips[c];
                    clips_out.push(json!({ "d": d, "evenOdd": eo }));
                    next
                });
                json!(i)
            }
        }
    };
    let mut items = Vec::new();
    for item in &dev.items {
        match item {
            Item::Path(pi) => {
                let mut v = json!({
                    "t": "path",
                    "d": pi.d,
                    "bbox": [pi.bbox.x0, pi.bbox.y0, pi.bbox.x1, pi.bbox.y1],
                    "fill": pi.fill.as_ref().map(fill_json),
                    "evenOdd": pi.even_odd,
                    "opacity": pi.opacity,
                    "blend": blend_name(pi.blend),
                    "clip": clip_ref(pi.clip, &dev),
                });
                if pi.glyphs {
                    v["glyphs"] = json!(true);
                }
                if let Some(r) = pi.rect {
                    v["rect"] = json!([r.x0, r.y0, r.x1, r.y1]);
                }
                if let Some(s) = &pi.stroke {
                    v["stroke"] = json!({ "paint": fill_json(&s.color), "width": s.width, "cap": s.cap, "join": s.join, "dash": s.dash });
                }
                items.push(v);
            }
            Item::Image(ii) => {
                let [a, b, c, d, e, f2] = ii.m.as_coeffs();
                items.push(json!({ "t": "image", "image": ii.image, "m": [a, b, c, d, e, f2], "opacity": ii.opacity, "blend": blend_name(ii.blend), "clip": clip_ref(ii.clip, &dev) }));
            }
            Item::Text(run) => {
                let fi = font_index(run.font, &mut fonts);
                let angle = run.dir.y.atan2(run.dir.x).to_degrees();
                for (text, start, end, tracking) in split_run(run) {
                    let o = run.origin + run.dir * start;
                    let mut v = json!({
                        "t": "text",
                        "text": text,
                        "font": fi,
                        "size": run.size,
                        "color": rgba_json(run.color),
                        "x": o.x,
                        "y": o.y,
                        "angle": if angle.abs() < 0.05 { 0.0 } else { angle },
                        "hscale": run.hscale,
                        "width": end - start,
                        "tracking": tracking,
                        "opacity": run.opacity,
                        "blend": blend_name(run.blend),
                    });
                    if let Some((c, w)) = run.stroke {
                        v["stroke"] = json!({ "color": rgba_json(c), "width": w });
                    }
                    items.push(v);
                }
            }
        }
    }
    let fonts_json: Vec<Value> = fonts
        .iter()
        .map(|k| {
            let m = fonts_meta.get(k).cloned().unwrap_or_else(|| FontMeta { name: if *k == 1 { "Type3".into() } else { "Helvetica".into() }, ..Default::default() });
            json!({ "name": m.name, "family": m.family, "weight": m.weight, "italic": m.italic, "bold": m.bold, "serif": m.serif, "fixed": m.fixed })
        })
        .collect();
    let json = json!({ "width": w, "height": h, "fonts": fonts_json, "clips": clips_out, "items": items });
    Some((json.to_string(), dev.images))
}
