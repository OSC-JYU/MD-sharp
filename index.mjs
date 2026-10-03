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

    return server;
};

init().catch(err => {
    console.error(err);
    process.exit(1);
});
