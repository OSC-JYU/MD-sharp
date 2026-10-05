import sharp from 'sharp';
import path from 'path';
import fs from 'fs-extra';
import { parseRegions, boundingBox, maskSvg, fillSvg, safeColor } from './rois.mjs';

const SUPPORTED_TASKS = ['resize', 'fit', 'flip', 'rotate', 'blur', 'convert', 'thumbnail', 'extract_rois', 'erase_rois'];

const FORMAT_MAP = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', tiff: 'tiff', tif: 'tiff', svg: 'png' };
const EXTENSION_MAP = { jpeg: 'jpg', png: 'png', webp: 'webp', tiff: 'tiff' };

function normalizeFormat(fmt) {
    return FORMAT_MAP[String(fmt || '').toLowerCase()] || null;
}

// large TIFF/SVG support mirrors the previous in-process sharp-thumbnailer adapter
function openImage(inputPath, { autoOrient = true } = {}) {
    let pipeline = sharp(inputPath, {
        limitInputPixels: false,
        sequentialRead: true,
        density: 150 // for SVG rasterization
    });
    if (autoOrient) pipeline = pipeline.rotate(); // auto-orient from EXIF
    return pipeline;
}

async function writeOutput(pipeline, format, outPath, quality) {
    if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: quality || 80 });
    else if (format === 'png') pipeline = pipeline.png();
    else if (format === 'webp') pipeline = pipeline.webp({ quality: quality || 80 });
    else if (format === 'tiff') pipeline = pipeline.tiff();
    await pipeline.toFile(outPath);
}

// `prefix` gives each output filename a unique namespace. Required in disk mode, where
// outDir is a shared scratch directory (MessyDesk's data/projects/tmp); harmless in API
// mode, where outDir is already a per-request uuid directory.
// `sourcePath`/`sourceExt` are the image a JSON input was derived from (message.file.source),
// needed by extract_rois, which runs on a roi.json / polygons.json file.
export async function runTask(task, inputPath, inputExt, outDir, params = {}, { prefix = '', sourcePath = null, sourceExt = null } = {}) {
    if (!SUPPORTED_TASKS.includes(task)) {
        throw new Error(`Unsupported task: ${task}`);
    }

    const inFormat = normalizeFormat(inputExt) || 'jpeg';
    const results = [];
    const ns = prefix ? `${prefix}-` : '';

    switch (task) {
        case 'resize': {
            const width = Number(params.width) || 400;
            const format = normalizeFormat(params.type) || inFormat;
            const outPath = path.join(outDir, `${ns}resize.${EXTENSION_MAP[format]}`);
            await writeOutput(
                openImage(inputPath).resize({ width, withoutEnlargement: true }),
                format, outPath, Number(params.quality)
            );
            results.push({ filename: path.basename(outPath), label: 'resize', extension: EXTENSION_MAP[format] });
            break;
        }

        case 'fit': {
            const width = Number(params.width) || 200;
            const height = Number(params.height) || 200;
            const format = normalizeFormat(params.type) || inFormat;
            const outPath = path.join(outDir, `${ns}fit.${EXTENSION_MAP[format]}`);
            await writeOutput(
                openImage(inputPath).resize(width, height, { fit: 'inside', withoutEnlargement: true }),
                format, outPath, Number(params.quality)
            );
            results.push({ filename: path.basename(outPath), label: 'fit', extension: EXTENSION_MAP[format] });
            break;
        }

        case 'flip': {
            const outPath = path.join(outDir, `${ns}flip.${EXTENSION_MAP[inFormat]}`);
            await writeOutput(openImage(inputPath).flip(), inFormat, outPath);
            results.push({ filename: path.basename(outPath), label: 'flip', extension: EXTENSION_MAP[inFormat] });
            break;
        }

        case 'rotate': {
            const angle = Number(params.rotate) || 90;
            const outPath = path.join(outDir, `${ns}rotate.${EXTENSION_MAP[inFormat]}`);
            // explicit angle replaces EXIF auto-orientation
            await writeOutput(openImage(inputPath, { autoOrient: false }).rotate(angle), inFormat, outPath);
            results.push({ filename: path.basename(outPath), label: 'rotate', extension: EXTENSION_MAP[inFormat] });
            break;
        }

        case 'blur': {
            const pipeline = openImage(inputPath);
            let sigma;
            if (params.amount !== undefined) {
                // scale sigma to image size so the same percentage looks similarly blurred regardless of resolution
                const amount = Math.min(100, Math.max(0, Number(params.amount) || 0));
                const { width, height } = await pipeline.metadata();
                const minDim = Math.min(width || 0, height || 0) || 1000;
                sigma = Math.min(1000, Math.max(0.3, (amount / 100) * minDim * 0.05));
            } else {
                sigma = Number(params.sigma) || 2;
            }
            const outPath = path.join(outDir, `${ns}blur.${EXTENSION_MAP[inFormat]}`);
            await writeOutput(pipeline.blur(sigma), inFormat, outPath);
            results.push({ filename: path.basename(outPath), label: 'blur', extension: EXTENSION_MAP[inFormat] });
            break;
        }

        case 'convert': {
            const format = normalizeFormat(params.type) || 'jpeg';
            const outPath = path.join(outDir, `${ns}convert.${EXTENSION_MAP[format]}`);
            await writeOutput(openImage(inputPath), format, outPath, Number(params.quality));
            results.push({ filename: path.basename(outPath), label: 'convert', extension: EXTENSION_MAP[format] });
            break;
        }

        case 'thumbnail': {
            // dual output: preview (default 800px) + fixed 200px thumbnail
            // labels 'preview'/'thumbnail' match MessyDesk's resolveThumbnailFilename() convention
            const previewWidth = Number(params.width) || 800;
            const previewPath = path.join(outDir, `${ns}preview.jpg`);
            await writeOutput(
                openImage(inputPath).resize({ width: previewWidth, withoutEnlargement: true }),
                'jpeg', previewPath, 80
            );
            results.push({ filename: path.basename(previewPath), label: 'preview', extension: 'jpg' });

            const thumbPath = path.join(outDir, `${ns}thumbnail.jpg`);
            await writeOutput(
                openImage(inputPath).resize({ width: 200, withoutEnlargement: true }),
                'jpeg', thumbPath, 80
            );
            results.push({ filename: path.basename(thumbPath), label: 'thumbnail', extension: 'jpg', thumb_name: 'thumbnail.jpg' });
            break;
        }

        case 'extract_rois': {
            if (!sourcePath) throw new Error('extract_rois needs the source image (message.file.source)');
            const regionsJson = await fs.readJSON(inputPath);
            const { load, width, height } = await openOriented(sourcePath);
            const regions = parseRegions(regionsJson, width, height, { which: params.layer });
            // mask: 'white' (default) fills outside a polygon/circle with white, 'transparent' keeps
            // it as alpha (always PNG), 'none' keeps the plain bounding box.
            const mask = ['transparent', 'none'].includes(params.mask) ? params.mask : 'white';
            const format = mask === 'transparent'
                ? 'png'
                : normalizeFormat(params.type) || normalizeFormat(sourceExt || path.extname(sourcePath).slice(1)) || 'jpeg';

            for (const [i, region] of regions.entries()) {
                const box = boundingBox(region, width, height);
                if (!box) continue;
                const safeLabel = String(region.label).replace(/[^\w.-]+/g, '_').slice(0, 60);
                const outPath = path.join(outDir, `${ns}${String(i + 1).padStart(3, '0')}-${safeLabel}.${EXTENSION_MAP[format]}`);
                let pipeline = load().extract(box);
                if (region.kind !== 'rect' && mask !== 'none') {
                    pipeline = pipeline.ensureAlpha().composite([{ input: maskSvg(region, box), blend: 'dest-in' }]);
                    // flatten runs before composite inside one pipeline, so whiten in a second pass
                    if (mask === 'white') pipeline = sharp(await pipeline.png().toBuffer()).flatten({ background: '#ffffff' });
                }
                await writeOutput(pipeline, format, outPath, Number(params.quality));
                results.push({ filename: path.basename(outPath), label: String(region.label), extension: EXTENSION_MAP[format] });
            }
            break;
        }

        case 'erase_rois': {
            // one output: the whole image with every region painted over in `color`
            if (!sourcePath) throw new Error('erase_rois needs the source image (message.file.source)');
            const regionsJson = await fs.readJSON(inputPath);
            const { load, width, height } = await openOriented(sourcePath);
            const regions = parseRegions(regionsJson, width, height, { which: params.layer })
                .filter(r => boundingBox(r, width, height));
            const format = normalizeFormat(params.type)
                || normalizeFormat(sourceExt || path.extname(sourcePath).slice(1)) || 'jpeg';
            const outPath = path.join(outDir, `${ns}erased.${EXTENSION_MAP[format]}`);
            const pipeline = regions.length
                ? load().composite([{ input: fillSvg(regions, width, height, safeColor(params.color)) }])
                : load();
            await writeOutput(pipeline, format, outPath, Number(params.quality));
            results.push({ filename: path.basename(outPath), label: 'erased', extension: EXTENSION_MAP[format] });
            break;
        }
    }

    return results;
}

// Region coordinates refer to the image as displayed, i.e. EXIF-oriented. Only an image that
// actually needs rotating is decoded up front; others are cropped straight from the file.
async function openOriented(imagePath) {
    const meta = await sharp(imagePath, { limitInputPixels: false }).metadata();
    if ((meta.orientation || 1) <= 1) {
        return { load: () => openImage(imagePath, { autoOrient: false }), width: meta.width, height: meta.height };
    }
    const { data, info } = await openImage(imagePath).raw().toBuffer({ resolveWithObject: true });
    const raw = { width: info.width, height: info.height, channels: info.channels };
    return { load: () => sharp(data, { raw }), width: info.width, height: info.height };
}

export { SUPPORTED_TASKS };
