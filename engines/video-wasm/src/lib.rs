//! FilmCraft for Nagma: read video files (MP4, MOV, MKV, WebM, MXF and more) frame by frame with
//! audio, and write MP4 files (H.264 video, AAC audio). Pure Rust, so every format FilmCraft
//! knows works in the browser, not only the ones the browser's own player can play.

use std::io::Cursor;
use std::sync::Arc;

use filmcraft_isobmff::{Brand, Mp4Writer, SampleEntry, TrackConfig, WriteSample, WriterOptions};
use filmcraft_media::{FrameRequest, MediaSource};
use filmcraft_time::{TICKS_PER_SECOND, Tick};
use serde_json::json;
use wasm_bindgen::prelude::*;

fn err(e: impl ToString) -> JsError {
    JsError::new(&e.to_string())
}

/// An opened media file.
#[wasm_bindgen]
pub struct VideoSource {
    src: Arc<dyn MediaSource>,
}

#[wasm_bindgen]
impl VideoSource {
    #[wasm_bindgen(constructor)]
    pub fn new(name: &str, bytes: Vec<u8>) -> Result<VideoSource, JsError> {
        let src = filmcraft_codecs::open_bytes(name, Arc::from(bytes)).map_err(err)?;
        Ok(VideoSource { src })
    }

    /// `{width, height, fps, seconds, hasVideo, hasAudio, codec, container, sampleRate, channels}`.
    pub fn info(&self) -> String {
        let info = self.src.info();
        let v = info.video.as_ref();
        let a = info.audio();
        json!({
            "width": v.map_or(0, |v| v.width),
            "height": v.map_or(0, |v| v.height),
            "fps": v.map_or(0.0, |v| v.frame_rate.as_f64()),
            "seconds": info.duration.seconds(),
            "hasVideo": v.is_some(),
            "hasAudio": a.is_some(),
            "codec": v.map(|v| v.codec.clone()).or_else(|| a.map(|a| a.codec.clone())).unwrap_or_default(),
            "container": info.container,
            "sampleRate": a.map_or(0, |a| a.sample_rate),
            "channels": a.map_or(0, |a| a.channels),
        })
        .to_string()
    }

    /// The frame shown at `seconds`, as straight RGBA8. `scale` under 1 asks for a smaller frame.
    pub fn frame(&self, seconds: f64, scale: f32) -> Result<RgbaFrame, JsError> {
        let frame = self.src.video_frame(FrameRequest { time: Tick::from_seconds_f64(seconds.max(0.0)), scale }).map_err(err)?;
        Ok(RgbaFrame { width: frame.width, height: frame.height, rgba: frame.to_rgba8() })
    }

    /// `frames` audio frames from `seconds`, resampled to `rate`, interleaved across `channels`
    /// (mono or stereo).
    pub fn audio(&self, seconds: f64, frames: usize, rate: u32, channels: usize) -> Result<Vec<f32>, JsError> {
        let start = ((seconds.max(0.0) * rate as f64).round()) as i64;
        let buf = self.src.audio(start, frames, rate).map_err(err)?;
        let n = buf.frames();
        let mut out = vec![0.0f32; frames * channels];
        for i in 0..n.min(frames) {
            for c in 0..channels {
                // A mono source feeds both channels; extra source channels are dropped.
                let ch = buf.channels.get(c).or_else(|| buf.channels.first());
                out[i * channels + c] = ch.and_then(|ch| ch.get(i)).copied().unwrap_or(0.0);
            }
        }
        Ok(out)
    }
}

#[wasm_bindgen]
pub struct RgbaFrame {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

#[wasm_bindgen]
impl RgbaFrame {
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

struct Packet {
    data: Vec<u8>,
    key: bool,
    cto: i32,
}

/// An MP4 writer: H.264 video from RGBA frames, and AAC audio from interleaved f32 samples.
#[wasm_bindgen]
pub struct Mp4Writer2 {
    enc: filmcraft_h264enc::Encoder,
    aac: Option<filmcraft_aac::Encoder>,
    width: u32,
    height: u32,
    fps: u32,
    rate: u32,
    channels: usize,
    frames: u64,
    video: Vec<Packet>,
    audio: Vec<Vec<u8>>,
    pending_audio: Vec<f32>,
    y: Vec<u8>,
    u: Vec<u8>,
    v: Vec<u8>,
}

#[wasm_bindgen]
impl Mp4Writer2 {
    /// `rate` 0 writes a silent file (no audio track).
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32, fps: u32, kbps: u32, rate: u32, channels: usize) -> Result<Mp4Writer2, JsError> {
        let (width, height) = (width.max(2) & !1, height.max(2) & !1);
        let fps = fps.clamp(1, 120);
        let mut cfg = filmcraft_h264enc::EncoderConfig::new(width, height, fps, 1);
        cfg.format = filmcraft_h264enc::PacketFormat::LengthPrefixed;
        cfg.aud = false;
        cfg.keyint = fps * 2;
        let kbps = kbps.max(100);
        cfg.rate = filmcraft_h264enc::RateControl::Vbr { target_kbps: kbps, max_kbps: kbps * 3 / 2 };
        let enc = filmcraft_h264enc::Encoder::new(cfg).map_err(err)?;
        let channels = channels.clamp(1, 2);
        let aac = if rate > 0 {
            Some(filmcraft_aac::Encoder::new(filmcraft_aac::EncoderConfig::cbr(rate, channels, 160_000 * channels as u32)).map_err(err)?)
        } else {
            None
        };
        Ok(Mp4Writer2 { enc, aac, width, height, fps, rate, channels, frames: 0, video: Vec::new(), audio: Vec::new(), pending_audio: Vec::new(), y: vec![], u: vec![], v: vec![] })
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
        self.video.extend(ps.into_iter().map(|p| Packet { data: p.data, key: p.keyframe, cto: (p.pts - p.dts) as i32 }));
        Ok(())
    }

    /// Interleaved f32 samples at the writer's rate and channel count, in any chunk size.
    #[wasm_bindgen(js_name = pushAudio)]
    pub fn push_audio(&mut self, samples: &[f32]) {
        if self.aac.is_none() {
            return;
        }
        self.pending_audio.extend_from_slice(samples);
        self.drain_audio(false);
    }

    /// The finished MP4 file.
    pub fn finish(mut self) -> Result<Vec<u8>, JsError> {
        let ps = self.enc.flush();
        self.video.extend(ps.into_iter().map(|p| Packet { data: p.data, key: p.keyframe, cto: (p.pts - p.dts) as i32 }));
        self.drain_audio(true);
        let avcc = filmcraft_isobmff::AvcConfig::parse(&self.enc.avcc()).unwrap_or_else(|_| {
            let (sps, pps) = self.enc.sps_pps();
            filmcraft_isobmff::AvcConfig::new(vec![sps], vec![pps], 4)
        });
        let opts = WriterOptions::new(Brand::Mp4);
        let movie_ts = opts.movie_timescale.max(1) as u64;
        let mut mux = Mp4Writer::new(Cursor::new(Vec::new()), opts).map_err(err)?;
        let mut track = TrackConfig::new(SampleEntry::avc(avcc, self.width as u16, self.height as u16), self.fps);
        if self.enc.delay() > 0 {
            track.edits = vec![filmcraft_isobmff::Edit { segment_duration: self.frames * movie_ts / self.fps as u64, media_time: 1, media_rate: 0x10000 }];
        }
        let vt = mux.add_track(track).map_err(err)?;
        for p in &self.video {
            mux.write_sample(vt, WriteSample { data: &p.data, duration: 1, composition_offset: p.cto, is_sync: p.key }).map_err(err)?;
        }
        if let Some(aac) = &self.aac {
            let mut c = TrackConfig::new(SampleEntry::aac(aac.audio_specific_config(), self.channels as u32, self.rate), self.rate);
            c.media_start = Some(aac.priming_samples() as i64);
            let at = mux.add_track(c).map_err(err)?;
            for au in &self.audio {
                mux.write_sample(at, WriteSample { data: au, duration: 1024, composition_offset: 0, is_sync: true }).map_err(err)?;
            }
        }
        Ok(mux.finish().map_err(err)?.into_inner())
    }
}

impl Mp4Writer2 {
    /// Encodes whole AAC frames (1024 samples per channel) from the pending audio; `all` pads
    /// the tail with silence.
    fn drain_audio(&mut self, all: bool) {
        let Some(aac) = self.aac.as_mut() else { return };
        let chans = self.channels;
        let block = 1024 * chans;
        if all && !self.pending_audio.is_empty() {
            let pad = (block - self.pending_audio.len() % block) % block;
            self.pending_audio.extend(std::iter::repeat_n(0.0, pad));
        }
        let whole = self.pending_audio.len() / block * block;
        if whole == 0 {
            return;
        }
        let chunk: Vec<f32> = self.pending_audio.drain(..whole).collect();
        let n = chunk.len() / chans;
        let planar: Vec<Vec<f32>> = (0..chans).map(|c| (0..n).map(|i| chunk[i * chans + c]).collect()).collect();
        let refs: Vec<&[f32]> = planar.iter().map(Vec::as_slice).collect();
        self.audio.extend(aac.encode(&refs));
        if all {
            self.audio.extend(aac.flush());
        }
    }
}

/// BT.709 limited-range 4:2:0 from RGBA (alpha over black).
fn rgba_to_yuv420(rgba: &[u8], w: usize, h: usize, y: &mut Vec<u8>, u: &mut Vec<u8>, v: &mut Vec<u8>) {
    let (cw, ch) = (w.div_ceil(2), h.div_ceil(2));
    y.resize(w * h, 0);
    u.resize(cw * ch, 0);
    v.resize(cw * ch, 0);
    let px = |x: usize, yy: usize| -> [f32; 3] {
        let i = (yy * w + x) * 4;
        let a = rgba[i + 3] as f32 / 255.0;
        [rgba[i] as f32 * a, rgba[i + 1] as f32 * a, rgba[i + 2] as f32 * a]
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

#[allow(dead_code)]
fn ticks(seconds: f64) -> Tick {
    Tick((seconds * TICKS_PER_SECOND as f64) as i64)
}
