'use strict';

const _ = require('lodash');
const { sanitizeEntity } = require('siapi-utils');
const validateSettings = require('../validation/settings');
const validateUploadBody = require('../validation/upload');

const sanitize = (data, options = {}) => {
  return sanitizeEntity(data, {
    model: siapi.getModel('file', 'upload'),
    ...options,
  });
};

module.exports = {
  async find(ctx) {
    const method = _.has(ctx.query, '_q') ? 'search' : 'fetchAll';

    const files = await siapi.plugins.upload.services.upload[method](ctx.query);

    ctx.body = sanitize(files);
  },

  async findOne(ctx) {
    const {
      params: { id },
    } = ctx;

    const file = await siapi.plugins.upload.services.upload.fetch({ id });

    if (!file) {
      return ctx.notFound('file.notFound');
    }

    ctx.body = sanitize(file);
  },

  async count(ctx) {
    const method = _.has(ctx.query, '_q') ? 'countSearch' : 'count';

    ctx.body = await siapi.plugins.upload.services.upload[method](ctx.query);
  },

  async destroy(ctx) {
    const {
      params: { id },
    } = ctx;

    const file = await siapi.plugins['upload'].services.upload.fetch({ id });

    if (!file) {
      return ctx.notFound('file.notFound');
    }

    await siapi.plugins['upload'].services.upload.remove(file);

    ctx.body = sanitize(file);
  },

  async updateSettings(ctx) {
    const {
      request: { body },
    } = ctx;

    const data = await validateSettings(body);

    await siapi.plugins.upload.services.upload.setSettings(data);

    ctx.body = { data };
  },

  async getSettings(ctx) {
    const data = await siapi.plugins.upload.services.upload.getSettings();

    ctx.body = { data };
  },

  async updateFileInfo(ctx) {
    const {
      query: { id },
      request: { body },
    } = ctx;
    const data = await validateUploadBody(body);

    const result = await siapi.plugins.upload.services.upload.updateFileInfo(id, data.fileInfo);

    ctx.body = sanitize(result);
  },

  async replaceFile(ctx) {
    const {
      query: { id },
      request: { body, files: { files } = {} },
    } = ctx;

    // cannot replace with more than one file
    if (Array.isArray(files)) {
      throw siapi.errors.badRequest(null, {
        errors: [
          { id: 'Upload.replace.single', message: 'Cannot replace a file with multiple ones' },
        ],
      });
    }

    const replacedFiles = await siapi.plugins.upload.services.upload.replace(id, {
      data: await validateUploadBody(body),
      file: files,
    });

    ctx.body = sanitize(replacedFiles);
  },

  async uploadFiles(ctx) {
    const {
      request: { body, files: { files } = {} },
    } = ctx;

    const uploadedFiles = await siapi.plugins.upload.services.upload.upload({
      data: await validateUploadBody(body),
      files,
    });

    ctx.body = sanitize(uploadedFiles);
  },
};
