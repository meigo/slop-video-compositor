//! Contain-fit transform → draw rect (mirrors frontend `src/lib/transform.ts`).

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DrawRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Draw rect of source on canvas given scale + pan (same formulas as TS `drawRect`).
pub fn draw_rect(
    src_w: u32,
    src_h: u32,
    canvas_w: u32,
    canvas_h: u32,
    scale: f64,
    tx: f64,
    ty: f64,
) -> DrawRect {
    if src_w == 0 || src_h == 0 {
        return DrawRect {
            x: 0.0,
            y: 0.0,
            w: 0.0,
            h: 0.0,
        };
    }

    // Contain-fit, then uniform scale about the framed center (pan is center offset).
    let fit_scale = f64::min(
        canvas_w as f64 / src_w as f64,
        canvas_h as f64 / src_h as f64,
    );
    let draw_w = src_w as f64 * fit_scale * scale;
    let draw_h = src_h as f64 * fit_scale * scale;
    let draw_x = (canvas_w as f64 - draw_w) / 2.0 + tx;
    let draw_y = (canvas_h as f64 - draw_h) / 2.0 + ty;

    DrawRect {
        x: draw_x,
        y: draw_y,
        w: draw_w,
        h: draw_h,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq(a: f64, b: f64) {
        assert!(
            (a - b).abs() < 1e-9,
            "expected {b}, got {a} (diff {})",
            (a - b).abs()
        );
    }

    #[test]
    fn contain_fits_same_size_identity() {
        // 1920x1080 into same canvas at scale=1, pan=0
        let r = draw_rect(1920, 1080, 1920, 1080, 1.0, 0.0, 0.0);
        approx_eq(r.x, 0.0);
        approx_eq(r.y, 0.0);
        approx_eq(r.w, 1920.0);
        approx_eq(r.h, 1080.0);
    }

    #[test]
    fn letterboxes_wide_canvas_for_square_source() {
        // fitScale = min(2, 1) = 1 → 100x100 centered → x=50
        let r = draw_rect(100, 100, 200, 100, 1.0, 0.0, 0.0);
        approx_eq(r.w, 100.0);
        approx_eq(r.h, 100.0);
        approx_eq(r.x, 50.0);
        approx_eq(r.y, 0.0);
    }

    #[test]
    fn applies_scale_about_center_and_pan() {
        let r = draw_rect(100, 100, 200, 100, 2.0, 10.0, -5.0);
        // (canvas - scaled)/2 + pan → x=10, y=-55
        approx_eq(r.w, 200.0);
        approx_eq(r.h, 200.0);
        approx_eq(r.x, 10.0);
        approx_eq(r.y, -55.0);
    }

    #[test]
    fn zero_source_returns_zero_rect() {
        let r = draw_rect(0, 100, 200, 100, 1.0, 0.0, 0.0);
        assert_eq!(r, DrawRect { x: 0.0, y: 0.0, w: 0.0, h: 0.0 });
        let r = draw_rect(100, 0, 200, 100, 1.0, 0.0, 0.0);
        assert_eq!(r, DrawRect { x: 0.0, y: 0.0, w: 0.0, h: 0.0 });
    }
}
