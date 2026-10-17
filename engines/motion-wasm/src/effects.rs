//! EffectCraft's effects library for Nagma's video editor: a catalog of the effects whose
//! parameters are plain values (numbers, colours, checkboxes, popups, points), and one call that
//! runs an effect on a straight RGBA frame.

use effectcraft_effects::{Buf, EffectCtx, EffectEnv, EffectSpec, Image, Params};
use effectcraft_keyframe::Value;
use effectcraft_project::ParamUi;
use serde_json::{Value as Json, json};
use wasm_bindgen::prelude::*;

fn err(e: impl ToString) -> JsError {
    JsError::new(&e.to_string())
}

/// What the editor can show and set for a parameter.
fn kind(ui: &ParamUi, default: &Value) -> Option<&'static str> {
    Some(match (ui, default) {
        (ParamUi::Hidden | ParamUi::Mask, _) => "hidden",
        (ParamUi::Checkbox, _) | (_, Value::Bool(_)) => "bool",
        (ParamUi::Popup { .. }, _) | (_, Value::Enum(_)) => "enum",
        (ParamUi::Color, _) | (_, Value::Color(_)) => "color",
        (ParamUi::Point, Value::Vec2(_)) => "point",
        (ParamUi::Angle, Value::Scalar(_)) => "angle",
        (ParamUi::Percent, Value::Scalar(_)) => "percent",
        (ParamUi::Pixels, Value::Scalar(_)) => "pixels",
        (_, Value::Scalar(_)) => "number",
        _ => return None,
    })
}

fn usable(spec: &EffectSpec) -> bool {
    spec.params.iter().all(|p| kind(&p.ui, &p.default).is_some())
}

/// `[{id, name, category, params: [{id, name, kind, default, min?, max?, sliderMin?, sliderMax?, options?}]}]`
/// for every effect whose parameters are plain values. Point defaults are fractions of the layer.
#[wasm_bindgen(js_name = effectCatalog)]
pub fn effect_catalog() -> String {
    let mut out = Vec::new();
    for spec in effectcraft_effects::all() {
        if !usable(spec) {
            continue;
        }
        let params: Vec<Json> = spec
            .params
            .iter()
            .filter_map(|p| {
                let k = kind(&p.ui, &p.default)?;
                let default = match &p.default {
                    Value::Scalar(v) => json!(v),
                    Value::Vec2(v) => json!(v),
                    Value::Color(c) => json!(c),
                    Value::Bool(b) => json!(b),
                    Value::Enum(e) => json!(e),
                    _ => Json::Null,
                };
                let mut o = json!({ "id": p.id, "name": p.name, "kind": k, "default": default });
                match &p.ui {
                    ParamUi::Slider { min, max, slider_min, slider_max, decimals } => {
                        o["min"] = json!(min);
                        o["max"] = json!(max);
                        o["sliderMin"] = json!(slider_min);
                        o["sliderMax"] = json!(slider_max);
                        o["decimals"] = json!(decimals);
                    }
                    ParamUi::Popup { options } => o["options"] = json!(options),
                    _ => {}
                }
                Some(o)
            })
            .collect();
        out.push(json!({ "id": spec.id, "name": spec.name, "category": spec.category, "params": params }));
    }
    Json::Array(out).to_string()
}

/// An effect's result: it can grow past the frame (a glow, a shadow), so it says where its
/// pixels sit: the frame's top left is at (`offsetX`, `offsetY`) in the result.
#[wasm_bindgen]
pub struct EffectFrame {
    width: u32,
    height: u32,
    offset_x: f64,
    offset_y: f64,
    rgba: Vec<u8>,
}

#[wasm_bindgen]
impl EffectFrame {
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }
    #[wasm_bindgen(getter, js_name = offsetX)]
    pub fn offset_x(&self) -> f64 {
        self.offset_x
    }
    #[wasm_bindgen(getter, js_name = offsetY)]
    pub fn offset_y(&self) -> f64 {
        self.offset_y
    }
    #[wasm_bindgen(getter)]
    pub fn rgba(&self) -> Vec<u8> {
        self.rgba.clone()
    }
}

fn num(v: &Json) -> Option<f64> {
    v.as_f64().or_else(|| v.as_bool().map(|b| if b { 1.0 } else { 0.0 }))
}

fn arr<const N: usize>(v: &Json) -> Option<[f64; N]> {
    let a = v.as_array()?;
    let mut out = [0.0; N];
    for (i, o) in out.iter_mut().enumerate() {
        *o = num(a.get(i)?)?;
    }
    Some(out)
}

/// Runs effect `id` on a `width` × `height` straight RGBA frame. `params` is a JSON object of
/// parameter values by id (numbers, `[x, y]` points as fractions of the layer, `[r, g, b, a]`
/// colours 0..1, booleans, popup indices); missing ones take the effect's defaults. The frame
/// shows the layer at `scale` (pixels per layer pixel) so a preview can run small; `time` is the
/// layer time in seconds.
#[wasm_bindgen(js_name = applyEffect)]
#[allow(clippy::too_many_arguments)]
pub fn apply_effect(id: &str, params: &str, rgba: &[u8], width: u32, height: u32, scale: f64, time: f64, fps: f64, seed: u32) -> Result<EffectFrame, JsError> {
    let spec = effectcraft_effects::find(id).ok_or_else(|| err(format!("no effect {id}")))?;
    if rgba.len() < width as usize * height as usize * 4 {
        return Err(err("frame is smaller than its size"));
    }
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    let layer = [width as f64 / scale, height as f64 / scale];
    let given: Json = serde_json::from_str(params).unwrap_or(Json::Null);
    let mut values = std::collections::HashMap::new();
    for p in &spec.params {
        let mut v = effectcraft_effects::default_value(p, layer);
        if let Some(g) = given.get(p.id) {
            v = match (&v, kind(&p.ui, &p.default)) {
                (Value::Scalar(_), _) => num(g).map(Value::Scalar).unwrap_or(v),
                (Value::Bool(_), _) => g.as_bool().or_else(|| num(g).map(|n| n != 0.0)).map(Value::Bool).unwrap_or(v),
                (Value::Enum(_), _) => num(g).map(|n| Value::Enum(n.max(0.0) as u32)).unwrap_or(v),
                (Value::Color(_), _) => arr::<4>(g).or_else(|| arr::<3>(g).map(|c| [c[0], c[1], c[2], 1.0])).map(Value::Color).unwrap_or(v),
                (Value::Vec2(_), Some("point")) => arr::<2>(g).map(|f| Value::Vec2([f[0] * layer[0], f[1] * layer[1]])).unwrap_or(v),
                (Value::Vec2(_), _) => arr::<2>(g).map(Value::Vec2).unwrap_or(v),
                _ => v,
            };
        }
        values.insert(p.id.to_string(), v);
    }
    let params = Params { values };
    let ctx = EffectCtx {
        params: &params,
        time,
        layer_size: layer,
        seed,
        adjustment: false,
        env: EffectEnv { comp_time: time, frame_rate: fps, ..EffectEnv::default() },
    };
    let buf = Buf { img: Image::from_rgba8(width, height, rgba), offset: [0.0, 0.0], scale };
    let out = effectcraft_effects::apply(spec, &ctx, buf);
    Ok(EffectFrame { width: out.img.width, height: out.img.height, offset_x: out.offset[0], offset_y: out.offset[1], rgba: out.img.to_rgba8() })
}
