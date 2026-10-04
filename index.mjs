import Hapi from '@hapi/hapi';
import fs from 'fs-extra';
import { routes, UPLOAD_DIR } from './lib/routes.mjs';

const init = async () => {
    // formidable does not create its uploadDir; a missing dir makes every /process fail.
    await fs.ensureDir(UPLOAD_DIR);

    const server = Hapi.server({
        port: process.env.PORT || 9000,
        host: '0.0.0.0'
    });

    server.route(routes);

    await server.start();
    console.log('md-sharp running on %s', server.info.uri);

    // Node as PID 1 in a container has no default signal handling: without this, stopping the
    // container waits for its timeout (10 s) and then kills the service mid-request.
    const shutdown = async (signal) => {
        console.log(`${signal}: shutting down`);
        await server.stop({ timeout: 5000 });
        process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

    return server;
};

init().catch(err => {
    console.error(err);
    process.exit(1);
});
