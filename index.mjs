import Hapi from '@hapi/hapi';
import { routes } from './lib/routes.mjs';

const init = async () => {
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
