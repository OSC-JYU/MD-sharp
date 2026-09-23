import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

function createHttpError(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

// service.json's local_url is a static dev default; override it at runtime so registration
// reflects the port Nomad actually assigned this allocation (see nomad.hcl's NOMAD_PORT_node).
function applyServiceLocalUrlOverride(descriptor) {
    const override = process.env.SERVICE_LOCAL_URL;
    if (typeof override === 'string' && override.trim()) {
        return { ...descriptor, local_url: override.trim() };
    }
    return descriptor;
}

export function getDefaultHelpCandidates(baseDir) {
    return [
        path.join(baseDir, 'help', 'index.md'),
        path.join(baseDir, 'README.md')
    ];
}

export async function loadServiceDescriptor(baseDir, descriptorFilename = 'service.json') {
    const descriptorPath = path.join(baseDir, descriptorFilename);

    let descriptor;
    try {
        descriptor = await fs.readJSON(descriptorPath);
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw createHttpError(500, 'service.json not found');
        }
        if (error.name === 'SyntaxError') {
            throw createHttpError(500, 'service.json is invalid JSON');
        }
        throw createHttpError(500, `Failed to read service.json: ${error.message}`);
    }

    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
        throw createHttpError(500, 'service.json must contain a JSON object');
    }

    return descriptor;
}

export async function loadHelpMarkdown(descriptor, helpCandidates) {
    for (const candidate of helpCandidates) {
        try {
            const exists = await fs.pathExists(candidate);
            if (exists) {
                return await fs.readFile(candidate, 'utf-8');
            }
        } catch (error) {
            throw createHttpError(500, `Failed to read help file: ${error.message}`);
        }
    }

    const serviceId = descriptor.id || 'md-base';
    const serviceName = descriptor.name || serviceId;
    const description = descriptor.description || 'No description available.';
    return `# ${serviceName}\n\nService id: ${serviceId}\n\n${description}\n`;
}

export function createServiceRegistrationRoutes({
    baseDir,
    descriptorFilename = 'service.json',
    helpCandidates,
    serviceId = 'md-base'
} = {}) {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const resolvedBaseDir = baseDir || path.resolve(moduleDir, '..');
    const candidates = helpCandidates || getDefaultHelpCandidates(resolvedBaseDir);

    return [
        {
            method: 'GET',
            path: '/health',
            handler: () => ({ status: 'ok', service: serviceId })
        },
        {
            method: 'GET',
            path: '/config',
            handler: async (request, h) => {
                try {
                    const descriptor = await loadServiceDescriptor(resolvedBaseDir, descriptorFilename);
                    return h.response(applyServiceLocalUrlOverride(descriptor)).code(200);
                } catch (error) {
                    return h.response({ error: error.message }).code(error.statusCode || 500);
                }
            }
        },
        {
            method: 'GET',
            path: '/help',
            handler: async (request, h) => {
                try {
                    const descriptor = await loadServiceDescriptor(resolvedBaseDir, descriptorFilename);
                    const markdown = await loadHelpMarkdown(descriptor, candidates);
                    return h.response(markdown).type('text/markdown; charset=utf-8').code(200);
                } catch (error) {
                    return h.response({ error: error.message }).code(error.statusCode || 500);
                }
            }
        }
    ];
}
