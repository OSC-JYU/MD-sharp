import sharp from 'sharp';
import path from 'path';

const SUPPORTED_TASKS = ['resize', 'fit', 'flip', 'rotate', 'blur', 'convert', 'thumbnail'];

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
export async function runTask(task, inputPath, inputExt, outDir, params = {}, { prefix = '' } = {}) {
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
            const sigma = Number(params.sigma) || 2;
            const outPath = path.join(outDir, `${ns}blur.${EXTENSION_MAP[inFormat]}`);
            await writeOutput(openImage(inputPath).blur(sigma), inFormat, outPath);
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
    }

    return results;
}

export { SUPPORTED_TASKS };
