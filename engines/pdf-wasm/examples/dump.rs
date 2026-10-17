//! Prints a page's extracted content as JSON: `cargo run --release --example dump -- file.pdf [page]`.
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&args[1]).expect("read");
    let page: usize = args.get(2).and_then(|p| p.parse().ok()).unwrap_or(0);
    let pdf = hayro::hayro_syntax::Pdf::new(std::sync::Arc::new(bytes)).expect("parse");
    let t = std::time::Instant::now();
    let (json, images) = nagma_pdf::extract::extract(&pdf, page, &Default::default()).expect("page");
    eprintln!("{} bytes of JSON, {} images, {:?}", json.len(), images.len(), t.elapsed());
    println!("{json}");
}
