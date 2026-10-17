//! Motion export for Nagma: frames Nagma draws itself are encoded to MP4 (H.264, FilmCraft's
//! encoder and MP4 writer) or animated GIF, and Lottie files are read back with EffectCraft's
//! importer to check what an exported animation contains.

mod effects;

use std::io::Cursor;

use filmcraft_isobmff::{Brand, Mp4Writer, SampleEntry, TrackConfig, WriteSample, WriterOptions};
use serde_json::json;
use wasm_bindgen::prelude::*;

fn err(e: impl ToString) -> JsError {
    JsError::new(&e.to_string())
}

struct Packet {
    data: Vec<u8>,
    key: bool,
    cto: i32,
}

/// H.264 in MP4. Frames go in as RGBA; the file comes out of `finish`.
#[wasm_bindgen]
pub struct Mp4Encoder {
    enc: filmcraft_h264enc::Encoder,
    width: u32,
    height: u32,
    fps: u32,
    frames: u64,
    packets: Vec<Packet>,
    y: Vec<u8>,
    u: Vec<u8>,
    v: Vec<u8>,
}

#[wasm_bindgen]
impl Mp4Encoder {
    /// `width` and `height` are rounded down to even numbers (4:2:0 video needs them).
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32, fps: u32, kbps: u32) -> Result<Mp4Encoder, JsError> {
        let (width, height) = (width.max(2) & !1, height.max(2) & !1);
        let fps = fps.clamp(1, 120);
        let mut cfg = filmcraft_h264enc::EncoderConfig::new(width, height, fps, 1);
        cfg.format = filmcraft_h264enc::PacketFormat::LengthPrefixed;
        cfg.aud = false;
        cfg.keyint = fps * 2;
        let kbps = kbps.max(100);
        cfg.rate = filmcraft_h264enc::RateControl::Vbr { target_kbps: kbps, max_kbps: kbps * 3 / 2 };
        let enc = filmcraft_h264enc::Encoder::new(cfg).map_err(err)?;
        Ok(Mp4Encoder { enc, width, height, fps, frames: 0, packets: Vec::new(), y: vec![], u: vec![], v: vec![] })
    }

    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }

    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }

    /// One frame of straight RGBA, `width` × `height`.
    pub fn push(&mut self, rgba: &[u8]) -> Result<(), JsError> {
        let (w, h) = (self.width as usize, self.height as usize);
        if rgba.len() < w * h * 4 {
            return Err(err("frame is smaller than the video"));
        }
        rgba_to_yuv420(rgba, w, h, &mut self.y, &mut self.u, &mut self.v);
        let frame = filmcraft_h264enc::YuvFrame { y: &self.y, u: &self.u, v: &self.v, y_stride: w, uv_stride: w.div_ceil(2) };
        let ps = self.enc.try_encode(&frame, self.frames as i64).map_err(err)?;
        self.frames += 1;
        self.keep(ps);
        Ok(())
    }

    /// The finished MP4 file.
    pub fn finish(mut self) -> Result<Vec<u8>, JsError> {
        let ps = self.enc.flush();
        self.keep(ps);
        let avcc = filmcraft_isobmff::AvcConfig::parse(&self.enc.avcc()).unwrap_or_else(|_| {
            let (sps, pps) = self.enc.sps_pps();
            filmcraft_isobmff::AvcConfig::new(vec![sps], vec![pps], 4)
        });
        let opts = WriterOptions::new(Brand::Mp4);
        let movie_ts = opts.movie_timescale.max(1) as u64;
        let mut mux = Mp4Writer::new(Cursor::new(Vec::new()), opts).map_err(err)?;
        let mut track = TrackConfig::new(SampleEntry::avc(avcc, self.width as u16, self.height as u16), self.fps);
        if self.enc.delay() > 0 {
            // Reordered frames start one frame in; an explicit edit keeps the full duration.
            track.edits = vec![filmcraft_isobmff::Edit { segment_duration: self.frames * movie_ts / self.fps as u64, media_time: 1, media_rate: 0x10000 }];
        }
        let t = mux.add_track(track).map_err(err)?;
        for p in &self.packets {
            mux.write_sample(t, WriteSample { data: &p.data, duration: 1, composition_offset: p.cto, is_sync: p.key }).map_err(err)?;
        }
        Ok(mux.finish().map_err(err)?.into_inner())
    }
}

impl Mp4Encoder {
    fn keep(&mut self, ps: Vec<filmcraft_h264enc::Packet>) {
        self.packets.extend(ps.into_iter().map(|p| Packet { data: p.data, key: p.keyframe, cto: (p.pts - p.dts) as i32 }));
    }
}

/// BT.709 limited-range 4:2:0 from RGBA (alpha over white, as the canvas would show it).
fn rgba_to_yuv420(rgba: &[u8], w: usize, h: usize, y: &mut Vec<u8>, u: &mut Vec<u8>, v: &mut Vec<u8>) {
    let (cw, ch) = (w.div_ceil(2), h.div_ceil(2));
    y.resize(w * h, 0);
    u.resize(cw * ch, 0);
    v.resize(cw * ch, 0);
    let px = |x: usize, yy: usize| -> [f32; 3] {
        let i = (yy * w + x) * 4;
        let a = rgba[i + 3] as f32 / 255.0;
        let c = |k: usize| rgba[i + k] as f32 * a + 255.0 * (1.0 - a);
        [c(0), c(1), c(2)]
    };
    for yy in 0..h {
        for x in 0..w {
            let [r, g, b] = px(x, yy);
            y[yy * w + x] = (16.0 + (0.1826 * r + 0.6142 * g + 0.0620 * b)).round().clamp(0.0, 255.0) as u8;
        }
    }
    for cy in 0..ch {
        for cx in 0..cw {
            let mut acc = [0.0f32; 3];
            let mut n = 0.0;
            for dy in 0..2 {
                for dx in 0..2 {
                    let (x, yy) = (cx * 2 + dx, cy * 2 + dy);
                    if x < w && yy < h {
                        let p = px(x, yy);
                        acc[0] += p[0];
                        acc[1] += p[1];
                        acc[2] += p[2];
                        n += 1.0;
                    }
                }
            }
            let [r, g, b] = acc.map(|c| c / n);
            u[cy * cw + cx] = (128.0 + (-0.1006 * r - 0.3386 * g + 0.4392 * b)).round().clamp(0.0, 255.0) as u8;
            v[cy * cw + cx] = (128.0 + (0.4392 * r - 0.3989 * g - 0.0403 * b)).round().clamp(0.0, 255.0) as u8;
        }
    }
}

/// An animated GIF, looping forever.
#[wasm_bindgen]
pub struct GifEncoder {
    enc: gif::Encoder<Vec<u8>>,
    width: u16,
    height: u16,
    delay: u16,
}

#[wasm_bindgen]
impl GifEncoder {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32, fps: u32) -> Result<GifEncoder, JsError> {
        let (width, height) = (width.clamp(1, 4096) as u16, height.clamp(1, 4096) as u16);
        let mut enc = gif::Encoder::new(Vec::new(), width, height, &[]).map_err(err)?;
        enc.set_repeat(gif::Repeat::Infinite).map_err(err)?;
        // GIF delays are in hundredths of a second.
        let delay = (100.0 / fps.clamp(1, 50) as f64).round().max(2.0) as u16;
        Ok(GifEncoder { enc, width, height, delay })
    }

    /// One frame of straight RGBA, `width` × `height`.
    pub fn push(&mut self, rgba: &[u8]) -> Result<(), JsError> {
        let mut px = rgba.to_vec();
        if px.len() < self.width as usize * self.height as usize * 4 {
            return Err(err("frame is smaller than the GIF"));
        }
        let mut frame = gif::Frame::from_rgba_speed(self.width, self.height, &mut px, 10);
        frame.delay = self.delay;
        self.enc.write_frame(&frame).map_err(err)
    }

    pub fn finish(self) -> Result<Vec<u8>, JsError> {
        self.enc.into_inner().map_err(err)
    }
}

/// Reads a Lottie file with EffectCraft's importer and describes it as JSON:
/// `{name, width, height, fps, frames, layers: [names], warnings}`.
#[wasm_bindgen(js_name = inspectLottie)]
pub fn inspect_lottie(bytes: &[u8]) -> Result<String, JsError> {
    let mut project = effectcraft_project::Project::default();
    let res = effectcraft_lottie::import(&mut project, bytes, "Animation", "", &mut |_| Some(String::new())).map_err(err)?;
    let comp = project.comp(res.comp).ok_or_else(|| err("no composition"))?;
    let name = project.item(res.comp).map(|i| i.name.clone()).unwrap_or_default();
    let fps = comp.frame_rate.as_f64();
    Ok(json!({
        "name": name,
        "width": comp.width,
        "height": comp.height,
        "fps": fps,
        "seconds": comp.duration.seconds(),
        "layers": comp.layers.iter().map(|l| l.name.clone()).collect::<Vec<_>>(),
        "warnings": res.warnings,
    })
    .to_string())
}
