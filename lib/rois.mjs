// Regions of interest as pixel shapes. Two input formats are understood:
//
//   roi.json       regions drawn in the MessyDesk UI, keyed by id (or wrapped in { rois }, or an array).
//                  Coordinates are percentages of the image:
//                    rect    { left, top, width, height }
//                    circle  { cx, cy, r }            r in percent of the shorter image side
//                    polygon { points: [{ xPct, yPct }] }
//   polygons.json  RF-DETR line segmentation output, pixel coordinates:
//                    { line_polygons: [[[x, y], ...]], region_polygons: [...] }
//                  (or { lines: [{ polygon }], regions: [{ polygon }] })
//
// Every region becomes { label, kind: 'rect' | 'circle' | 'polygon', ... } in pixels.

const num = (v) => Number(v) || 0;

function fromPercentShape(shape, index, width, height) {
    const label = shape.label || shape.name || shape.id || `roi_${String(index + 1).padStart(3, '0')}`;
    if (shape.type === 'rect' || (shape.type === undefined && shape.width !== undefined)) {
        return {
            label, kind: 'rect',
            x: num(shape.left) / 100 * width,
            y: num(shape.top) / 100 * height,
            w: num(shape.width) / 100 * width,
            h: num(shape.height) / 100 * height,
        };
    }
    if (shape.type === 'circle') {
        return {
            label, kind: 'circle',
            cx: num(shape.cx) / 100 * width,
            cy: num(shape.cy) / 100 * height,
            r: num(shape.r) / 100 * Math.min(width, height),
        };
    }
    if (Array.isArray(shape.points)) {
        return {
            label, kind: 'polygon',
            points: shape.points.map(p => [num(p.xPct) / 100 * width, num(p.yPct) / 100 * height]),
        };
    }
    return null;
}

function fromPixelPolygons(polygons, prefix) {
    return (polygons || [])
        .map(p => (Array.isArray(p) ? p : p?.polygon))
        .filter(p => Array.isArray(p) && p.length >= 3)
        .map((points, i) => ({
            label: `${prefix}_${String(i + 1).padStart(3, '0')}`,
            kind: 'polygon',
            points: points.map(([x, y]) => [num(x), num(y)]),
        }));
}

/** `which` picks the polygons.json layer: 'lines' (default) or 'regions'. */
export function parseRegions(data, width, height, { which = 'lines' } = {}) {
    if (data && !Array.isArray(data) && (data.line_polygons || data.region_polygons || data.lines || data.regions)) {
        const layer = which === 'regions' ? 'region' : 'line';
        return fromPixelPolygons(data[`${layer}_polygons`] || data[`${layer}s`], layer);
    }
    const map = data?.rois && typeof data.rois === 'object' ? data.rois : data;
    const shapes = Array.isArray(map) ? map : Object.values(map || {});
    return shapes
        .filter(s => s && typeof s === 'object')
        .map((s, i) => fromPercentShape(s, i, width, height))
        .filter(Boolean);
}

/** Pixel bounding box clamped to the image, or null when nothing of it lies inside. */
export function boundingBox(region, width, height) {
    let x0, y0, x1, y1;
    if (region.kind === 'rect') {
        [x0, y0, x1, y1] = [region.x, region.y, region.x + region.w, region.y + region.h];
    } else if (region.kind === 'circle') {
        [x0, y0, x1, y1] = [region.cx - region.r, region.cy - region.r, region.cx + region.r, region.cy + region.r];
    } else {
        const xs = region.points.map(p => p[0]);
        const ys = region.points.map(p => p[1]);
        [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    const left = Math.max(0, Math.floor(x0));
    const top = Math.max(0, Math.floor(y0));
    const right = Math.min(width, Math.ceil(x1));
    const bottom = Math.min(height, Math.ceil(y1));
    if (right - left < 1 || bottom - top < 1) return null;
    return { left, top, width: right - left, height: bottom - top };
}

/** SVG of the region's shape (white on transparent), positioned relative to its bounding box. */
export function maskSvg(region, box) {
    let shape;
    if (region.kind === 'circle') {
        shape = `<circle cx="${region.cx - box.left}" cy="${region.cy - box.top}" r="${region.r}"/>`;
    } else {
        const pts = region.points.map(([x, y]) => `${x - box.left},${y - box.top}`).join(' ');
        shape = `<polygon points="${pts}"/>`;
    }
    return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}"><g fill="#fff">${shape}</g></svg>`
    );
}
