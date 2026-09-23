import Joi from 'joi';
import formidable from 'formidable';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { runTask, SUPPORTED_TASKS } from './imageOps.mjs';
import { resolveMdRelativePath, resolveTmpDir, MD_ROOT } from './diskStorage.mjs';
import { createServiceRegistrationRoutes } from './service_registration.mjs';

const SERVICE_ID = process.env.SERVICE_ID || 'md-sharp';

const messageSchema = Joi.object({
    task: Joi.object({
        id: Joi.string().required().valid(...SUPPORTED_TASKS),
        params: Joi.object().optional().default({}).unknown(true)
    }).unknown(true).required(),
    file: Joi.any().optional()
}).unknown(true);

function getFilePath(file) {
    if (!file) return null;
    if (Array.isArray(file)) return file[0]?.filepath || file[0]?.path || null;
    return file.filepath || file.path || null;
}

async function parseMessageJSON(messageFilepath) {
    let messageJSON;
    try {
        messageJSON = await fs.readJSON(messageFilepath);
    } catch (parseError) {
        const messageText = await fs.readFile(messageFilepath, 'utf-8');
        messageJSON = JSON.parse(messageText);
    }
    if (typeof messageJSON === 'string') {
        messageJSON = JSON.parse(messageJSON);
    }

    const { error } = messageSchema.validate(messageJSON);
    if (error) {
        throw new Error(`Invalid message format: ${error.message}`);
    }
    return messageJSON;
}

// API mode: content was uploaded, output is served back over HTTP from ./data/<uuid>/.
async function processApiMode(messageJSON, contentFilepath) {
    const task = messageJSON.task.id;
    const params = messageJSON.task.params || {};
    const inputExt = String(
        messageJSON.file?.extension || path.extname(contentFilepath).replace('.', '') || 'jpg'
    ).toLowerCase();

    const dirname = uuidv4();
    const outDir = path.join('data', dirname);
    await fs.mkdir(outDir, { recursive: true });

    const results = await runTask(task, contentFilepath, inputExt, outDir, params);

    return {
        response: {
            uri: results.map(r => ({
                uri: `/files/${dirname}/${r.filename}`,
                ...(r.thumb_name ? { thumb_name: r.thumb_name } : {})
            }))
        }
    };
}

// Disk mode: no content upload, message.file.path is read/written directly on the shared
// MD_PATH volume. Response matches MD-consumers' `elg_fs` adapter contract (response.files),
// which posts a tmp_path callback to MessyDesk without ever touching file bytes itself.
async function processDiskMode(messageJSON) {
    if (!MD_ROOT) {
        throw new Error('Disk mode requested (no content upload) but MD_PATH is not configured on this service');
    }

    const task = messageJSON.task.id;
    const params = messageJSON.task.params || {};
    const sourceRelPath = messageJSON.file?.path;
    const inputPath = resolveMdRelativePath(sourceRelPath);
    const inputExt = String(
        messageJSON.file?.extension || path.extname(inputPath).replace('.', '') || 'jpg'
    ).toLowerCase();

    const tmpDir = resolveTmpDir(sourceRelPath);
    await fs.mkdir(tmpDir, { recursive: true });

    const results = await runTask(task, inputPath, inputExt, tmpDir, params, { prefix: uuidv4() });

    return {
        response: {
            files: results.map(r => ({
                path: r.filename,
                label: r.label,
                extension: r.extension,
                type: 'image'
            }))
        }
    };
}

export const routes = [
    {
        method: 'GET',
        path: '/',
        handler: (request, h) => {
            return 'md-sharp API';
        }
    },
    {
        method: 'POST',
        path: '/process',
        options: {
            payload: {
                output: 'stream',
                parse: false,
                maxBytes: 104857600,
                allow: 'multipart/form-data'
            }
        },
        handler: async (request, h) => {
            const form = formidable({
                uploadDir: './uploads',
                keepExtensions: true,
                maxFileSize: 104857600
            });

            const { fields, files: filesParsed } = await new Promise((resolve, reject) => {
                form.parse(request.payload, (err, fields, filesParsed) => {
                    if (err) return reject(err);
                    resolve({ fields, files: filesParsed });
                });
            });

            console.log('Files received:', Object.keys(filesParsed));

            const messageFile = filesParsed.message || filesParsed.request;
            const contentFile = filesParsed.content;

            if (!messageFile) {
                console.error('Missing message file. Available fields:', Object.keys(filesParsed));
                return h.response({ error: 'Missing required files', availableFields: Object.keys(filesParsed) }).code(400);
            }

            const messageFilepath = getFilePath(messageFile);
            const contentFilepath = contentFile ? getFilePath(contentFile) : null;

            if (!messageFilepath) {
                return h.response({ error: 'Could not determine file paths', messageFilepath, contentFilepath }).code(400);
            }

            try {
                const messageJSON = await parseMessageJSON(messageFilepath);
                console.log('task', messageJSON.task.id, 'params', messageJSON.task.params, 'mode', contentFilepath ? 'api' : 'disk');

                const result = contentFilepath
                    ? await processApiMode(messageJSON, contentFilepath)
                    : await processDiskMode(messageJSON);

                if (contentFilepath) await fs.unlink(contentFilepath);
                await fs.unlink(messageFilepath);

                return result;

            } catch (e) {
                console.log(e);
                console.log(e.message);
                try {
                    if (contentFilepath) await fs.unlink(contentFilepath);
                    if (messageFilepath) await fs.unlink(messageFilepath);
                } catch (e) {
                    console.log('Removing of temp files failed');
                }
                return h.response({ error: e.message }).code(500);
            }
        }
    },
    {
        method: 'GET',
        path: '/files/{dir}/{file}',
        handler: async (request, h) => {
            const input_path = path.join('data', request.params.dir, request.params.file);

            try {
                await fs.access(input_path);
            } catch (error) {
                return h.response({ error: 'File not found' }).code(404);
            }

            const readStream = fs.createReadStream(input_path);
            let deleted = false;

            const deleteFile = async () => {
                if (deleted) return;
                deleted = true;

                try {
                    await fs.unlink(input_path);
                    console.log(`Deleted file: ${input_path}`);
                    const dirPath = path.dirname(input_path);
                    try {
                        await fs.rm(dirPath, { recursive: true });
                        console.log(`Removed empty directory: ${dirPath}`);
                    } catch (err) {
                        console.log(`Directory not empty: ${dirPath}`);
                    }
                } catch (error) {
                    console.error(`Failed to delete file ${input_path}:`, error.message);
                }
            };

            readStream.on('close', deleteFile);
            readStream.on('end', deleteFile);
            readStream.on('error', async (error) => {
                console.error(`Stream error for ${input_path}:`, error.message);
                await deleteFile();
            });

            return h.response(readStream)
                .header('Content-Disposition', `attachment; filename=${request.params.file}`)
                .type('application/octet-stream');
        }
    },
    ...createServiceRegistrationRoutes({
        serviceId: SERVICE_ID
    })
];
