'use strict';

const { resolve } = require('path');
const range = require('koa-range');
const koaStatic = require('koa-static');
const _ = require('lodash');

module.exports = siapi => ({
  initialize() {
    const configPublicPath = siapi.config.get(
      'middleware.settings.public.path',
      siapi.config.paths.static
    );
    const staticDir = resolve(siapi.dir, configPublicPath);

    siapi.app.on('error', err => {
      if (err.code === 'EPIPE') {
        // when serving audio or video the browsers sometimes close the connection to go to range requests instead.
        // This causes koa to emit a write EPIPE error. We can ignore it.
        // Right now this ignores it globally and we cannot do much more because it is how koa handles it.
        return;
      }

      siapi.app.onerror(err);
    });

    const localServerConfig =
      _.get(siapi, 'plugins.upload.config.providerOptions.localServer') || {};
    siapi.router.get(
      '/uploads/(.*)',
      range,
      koaStatic(staticDir, { defer: true, ...localServerConfig })
    );
  },
});
