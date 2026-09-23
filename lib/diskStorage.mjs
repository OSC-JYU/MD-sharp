import { existsSync, statSync } from 'fs';
import path from 'path';

const MD_PATH_ENV = process.env.MD_PATH || '';
const CONTAINER_MODE = ['1', 'true', 'yes', 'on'].includes(String(process.env.CONTAINER || '').trim().toLowerCase());

function hasDataDir(candidate) {
    try {
        const dataDir = path.join(candidate, 'data');
        return existsSync(dataDir) && statSync(dataDir).isDirectory();
    } catch {
        return false;
    }
}

// Disk mode is optional: md-sharp works purely as an API when MD_PATH is unset.
function resolveMdRoot(mdPathEnv, containerMode) {
    if (!mdPathEnv || !String(mdPathEnv).trim()) return null;

    const candidates = [];
    const raw = path.resolve(String(mdPathEnv).trim());
    candidates.push(path.basename(raw) === 'data' ? path.dirname(raw) : raw);
    if (containerMode) candidates.push('/app');

    for (const candidate of candidates) {
        if (hasDataDir(candidate)) return candidate;
    }
    return null;
}

export const MD_ROOT = resolveMdRoot(MD_PATH_ENV, CONTAINER_MODE);

if (MD_ROOT) {
    console.log(`md-sharp: disk storage mode available via MD_PATH = ${MD_ROOT}`);
} else {
    console.log('md-sharp: no usable MD_PATH, disk storage mode disabled (API-only)');
}

// Mirrors MessyDesk's src/adapters solr.mjs traversal protection.
export function resolveMdRelativePath(relativePath) {
    if (!MD_ROOT) throw new Error('MD_PATH is not configured on this service');
    if (!relativePath || !String(relativePath).trim()) throw new Error('Invalid file.path');
    if (path.isAbsolute(relativePath)) throw new Error('file.path must be relative to MD_PATH');

    const mdRoot = path.resolve(MD_ROOT);
    const resolved = path.resolve(mdRoot, relativePath);
    if (resolved !== mdRoot && !resolved.startsWith(mdRoot + path.sep)) {
        throw new Error('file.path is outside MD_PATH');
    }
    if (!existsSync(resolved)) throw new Error('Source file not found on disk');

    return resolved;
}

// Mirrors MessyDesk's resolveTmpFilePath() in processFilesController.mjs: the shared
// scratch dir is <MD_ROOT>/data/<first-path-segment-after-"data">/tmp (in practice
// always .../data/projects/tmp), looked up again by the backend from message.file.path.
// We must write into the exact same directory so the tmp_path (basename) callback resolves.
export function resolveTmpDir(sourceRelPath) {
    if (!MD_ROOT) throw new Error('MD_PATH is not configured on this service');

    const normalized = String(sourceRelPath || '').replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);

    for (let i = 0; i < parts.length - 1; i += 1) {
        if (parts[i] === 'data' && parts[i + 1]) {
            return path.resolve(MD_ROOT, 'data', parts[i + 1], 'tmp');
        }
    }
    return path.resolve(MD_ROOT, 'data', 'tmp');
}
