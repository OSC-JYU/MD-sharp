import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { runTask } from '../lib/imageOps.mjs';
import { parseRegions, boundingBox } from '../lib/rois.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const fixture = (name) => path.join(here, name);

async function tmpDir() {
    return fs.mkdtemp(path.join(os.tmpdir(), 'md-sharp-test-'));
}

test('roi.json percentages become pixel regions', () => {
    const regions = parseRegions(fs.readJSONSync(fixture('sample.roi.json')), 640, 480);
    assert.deepEqual(regions.map(r => r.kind), ['rect', 'circle', 'polygon']);
    assert.deepEqual(boundingBox(regions[0], 640, 480), { left: 64, top: 48, width: 160, height: 240 });
    // r is a percentage of the shorter side: 20% of 480 = 96
    assert.deepEqual(boundingBox(regions[1], 640, 480), { left: 288, top: 144, width: 192, height: 192 });
});

test('regions outside the image are clamped or dropped', () => {
    const [inside, outside] = parseRegions([
        { type: 'rect', left: 90, top: 90, width: 50, height: 50 },
        { type: 'rect', left: 120, top: 0, width: 10, height: 10 },
    ], 100, 100);
    assert.deepEqual(boundingBox(inside, 100, 100), { left: 90, top: 90, width: 10, height: 10 });
    assert.equal(boundingBox(outside, 100, 100), null);
});

test('extract_rois cuts one image per roi.json region', async () => {
    const out = await tmpDir();
    const results = await runTask('extract_rois', fixture('sample.roi.json'), 'json', out, { mask: 'transparent' },
        { sourcePath: fixture('sample.jpg') });
    assert.equal(results.length, 3);
    assert.equal(results[0].label, 'left box');
    const rect = await sharp(path.join(out, results[0].filename)).metadata();
    assert.deepEqual([rect.width, rect.height], [160, 240]);
    // the circle's bounding-box corner lies outside the circle: transparent
    const { data, info } = await sharp(path.join(out, results[1].filename)).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.channels, 4);
    assert.equal(data[3], 0, 'corner outside the circle is transparent');
    const centre = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4;
    assert.equal(data[centre + 3], 255, 'centre of the circle is opaque');
    await fs.remove(out);
});

test('extract_rois cuts the lines of an RF-DETR polygons.json', async () => {
    const out = await tmpDir();
    const results = await runTask('extract_rois', fixture('htr3.polygons.json'), 'json', out, {},
        { sourcePath: fixture('htr3.jpg'), sourceExt: 'jpg' });
    assert.equal(results.length, 8);
    assert.equal(results[0].label, 'line_001');
    assert.equal(results[0].extension, 'jpg');
    const regions = await runTask('extract_rois', fixture('htr3.polygons.json'), 'json', out, { layer: 'regions' },
        { sourcePath: fixture('htr3.jpg'), prefix: 'r' });
    assert.equal(regions.length, 1);
    await fs.remove(out);
});

test('extract_rois without a source image fails clearly', async () => {
    await assert.rejects(
        runTask('extract_rois', fixture('sample.roi.json'), 'json', os.tmpdir(), {}),
        /needs the source image/
    );
});

async function pixel(file, x, y) {
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
}

test('erase_rois fills every region of a roi.json in one output image', async () => {
    const out = await tmpDir();
    const results = await runTask('erase_rois', fixture('sample.roi.json'), 'json', out, { color: '#ff0000', type: 'png' },
        { sourcePath: fixture('sample.jpg') });
    assert.equal(results.length, 1);
    const erased = path.join(out, results[0].filename);
    const meta = await sharp(erased).metadata();
    assert.deepEqual([meta.width, meta.height], [640, 480]);
    // centre of the rect, the circle and the triangle are red; a point outside all is untouched
    for (const [x, y] of [[144, 168], [384, 240], [525, 100]]) {
        assert.deepEqual(await pixel(erased, x, y), [255, 0, 0], `(${x},${y}) is filled`);
    }
    assert.deepEqual(await pixel(erased, 20, 460), await pixel(fixture('sample.jpg'), 20, 460));
    await fs.remove(out);
});

test('erase_rois fills all lines of a polygons.json', async () => {
    const out = await tmpDir();
    const polygons = fs.readJSONSync(fixture('htr3.polygons.json')).line_polygons;
    const results = await runTask('erase_rois', fixture('htr3.polygons.json'), 'json', out, { color: '#00ff00', type: 'png' },
        { sourcePath: fixture('htr3.jpg') });
    const erased = path.join(out, results[0].filename);
    // the centre of every line is now green
    for (const line of polygons) {
        const xs = line.map(p => p[0]); const ys = line.map(p => p[1]);
        const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
        const cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);
        assert.deepEqual(await pixel(erased, cx, cy), [0, 255, 0], `line centre (${cx},${cy}) is filled`);
    }
    await fs.remove(out);
});

test('erase_rois rejects a color that is not a plain color', async () => {
    const { safeColor } = await import('../lib/rois.mjs');
    assert.equal(safeColor('"/><script>'), '#ffffff');
    assert.equal(safeColor('#123abc'), '#123abc');
    assert.equal(safeColor('black'), 'black');
});
