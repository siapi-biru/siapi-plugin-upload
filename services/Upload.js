'use strict';

/**
 * Upload.js service
 *
 * @description: A set of functions similar to controller's actions to avoid code duplication.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const util = require('util');
const _ = require('lodash');
const {
  nameToSlug,
  contentTypes: contentTypesUtils,
  sanitizeEntity,
  webhook: webhookUtils,
} = require('siapi-utils');

const { MEDIA_UPDATE, MEDIA_CREATE, MEDIA_DELETE } = webhookUtils.webhookEvents;

const { bytesToKbytes } = require('../utils/file');

const { UPDATED_BY_ATTRIBUTE, CREATED_BY_ATTRIBUTE } = contentTypesUtils.constants;

const randomSuffix = () => crypto.randomBytes(5).toString('hex');

const generateFileName = name => {
  const baseName = nameToSlug(name, { separator: '_', lowercase: false });

  return `${baseName}_${randomSuffix()}`;
};

const sendMediaMetrics = data => {
  if (_.has(data, 'caption') && !_.isEmpty(data.caption)) {
    siapi.telemetry.send('didSaveMediaWithCaption');
  }

  if (_.has(data, 'alternativeText') && !_.isEmpty(data.alternativeText)) {
    siapi.telemetry.send('didSaveMediaWithAlternativeText');
  }
};

const combineFilters = params => {
  // FIXME: until we support boolean operators for querying we need to make mime_ncontains use AND instead of OR
  if (_.has(params, 'mime_ncontains') && Array.isArray(params.mime_ncontains)) {
    params._where = params.mime_ncontains.map(val => ({ mime_ncontains: val }));
    delete params.mime_ncontains;
  }
};

module.exports = {
  formatFileInfo({ filename, type, size }, fileInfo = {}, metas = {}) {
    const ext = path.extname(filename);
    const basename = path.basename(fileInfo.name || filename, ext);

    const usedName = fileInfo.name || filename;

    const entity = {
      name: usedName,
      alternativeText: fileInfo.alternativeText,
      caption: fileInfo.caption,
      hash: generateFileName(basename),
      ext,
      mime: type,
      size: bytesToKbytes(size),
    };

    const { refId, ref, source, field } = metas;

    if (refId && ref && field) {
      entity.related = [
        {
          refId,
          ref,
          source,
          field,
        },
      ];
    }

    if (metas.path) {
      entity.path = metas.path;
    }

    return entity;
  },

  async enhanceFile(file, fileInfo = {}, metas = {}) {
    let readBuffer;
    try {
      readBuffer = await util.promisify(fs.readFile)(file.path);
    } catch (e) {
      if (e.code === 'ERR_FS_FILE_TOO_LARGE') {
        throw siapi.errors.entityTooLarge('FileTooBig', {
          errors: [
            {
              id: 'Upload.status.sizeLimit',
              message: `${file.name} file is bigger than the limit size!`,
              values: { file: file.name },
            },
          ],
        });
      }
      throw e;
    }

    const { optimize } = siapi.plugins.upload.services['image-manipulation'];

    const { buffer, info } = await optimize(readBuffer);

    const formattedFile = this.formatFileInfo(
      {
        filename: file.name,
        type: file.type,
        size: file.size,
      },
      fileInfo,
      metas
    );

    return _.assign(formattedFile, info, {
      buffer,
    });
  },

  async upload({ data, files }, { user } = {}) {
    const { fileInfo, ...metas } = data;

    const fileArray = Array.isArray(files) ? files : [files];
    const fileInfoArray = Array.isArray(fileInfo) ? fileInfo : [fileInfo];

    const doUpload = async (file, fileInfo) => {
      const fileData = await this.enhanceFile(file, fileInfo, metas);

      return this.uploadFileAndPersist(fileData, { user });
    };

    return await Promise.all(
      fileArray.map((file, idx) => doUpload(file, fileInfoArray[idx] || {}))
    );
  },

  async uploadFileAndPersist(fileData, { user } = {}) {
    const config = siapi.plugins.upload.config;

    const {
      getDimensions,
      generateThumbnail,
      generateResponsiveFormats,
    } = siapi.plugins.upload.services['image-manipulation'];

    await siapi.plugins.upload.provider.upload(fileData);

    const thumbnailFile = await generateThumbnail(fileData);
    if (thumbnailFile) {
      await siapi.plugins.upload.provider.upload(thumbnailFile);
      delete thumbnailFile.buffer;
      _.set(fileData, 'formats.thumbnail', thumbnailFile);
    }

    const formats = await generateResponsiveFormats(fileData);
    if (Array.isArray(formats) && formats.length > 0) {
      for (const format of formats) {
        if (!format) continue;

        const { key, file } = format;

        await siapi.plugins.upload.provider.upload(file);
        delete file.buffer;

        _.set(fileData, ['formats', key], file);
      }
    }

    const { width, height } = await getDimensions(fileData.buffer);

    delete fileData.buffer;

    _.assign(fileData, {
      provider: config.provider,
      width,
      height,
    });

    return this.add(fileData, { user });
  },

  async updateFileInfo(id, { name, alternativeText, caption }, { user } = {}) {
    const dbFile = await this.fetch({ id });

    if (!dbFile) {
      throw siapi.errors.notFound('file not found');
    }

    const newInfos = {
      name: _.isNil(name) ? dbFile.name : name,
      alternativeText: _.isNil(alternativeText) ? dbFile.alternativeText : alternativeText,
      caption: _.isNil(caption) ? dbFile.caption : caption,
    };

    return this.update({ id }, newInfos, { user });
  },

  async replace(id, { data, file }, { user } = {}) {
    const config = siapi.plugins.upload.config;

    const {
      getDimensions,
      generateThumbnail,
      generateResponsiveFormats,
    } = siapi.plugins.upload.services['image-manipulation'];

    const dbFile = await this.fetch({ id });

    if (!dbFile) {
      throw siapi.errors.notFound('file not found');
    }

    const { fileInfo } = data;
    const fileData = await this.enhanceFile(file, fileInfo);

    // keep a constant hash
    _.assign(fileData, {
      hash: dbFile.hash,
      ext: dbFile.ext,
    });

    // execute delete function of the provider
    if (dbFile.provider === config.provider) {
      await siapi.plugins.upload.provider.delete(dbFile);

      if (dbFile.formats) {
        await Promise.all(
          Object.keys(dbFile.formats).map(key => {
            return siapi.plugins.upload.provider.delete(dbFile.formats[key]);
          })
        );
      }
    }

    await siapi.plugins.upload.provider.upload(fileData);

    // clear old formats
    _.set(fileData, 'formats', {});

    const thumbnailFile = await generateThumbnail(fileData);
    if (thumbnailFile) {
      await siapi.plugins.upload.provider.upload(thumbnailFile);
      delete thumbnailFile.buffer;
      _.set(fileData, 'formats.thumbnail', thumbnailFile);
    }

    const formats = await generateResponsiveFormats(fileData);
    if (Array.isArray(formats) && formats.length > 0) {
      for (const format of formats) {
        if (!format) continue;

        const { key, file } = format;

        await siapi.plugins.upload.provider.upload(file);
        delete file.buffer;

        _.set(fileData, ['formats', key], file);
      }
    }

    const { width, height } = await getDimensions(fileData.buffer);
    delete fileData.buffer;

    _.assign(fileData, {
      provider: config.provider,
      width,
      height,
    });

    return this.update({ id }, fileData, { user });
  },

  async update(params, values, { user } = {}) {
    const fileValues = { ...values };
    if (user) {
      fileValues[UPDATED_BY_ATTRIBUTE] = user.id;
    }
    sendMediaMetrics(fileValues);

    const res = await siapi.query('file', 'upload').update(params, fileValues);
    const modelDef = siapi.getModel('file', 'upload');
    siapi.eventHub.emit(MEDIA_UPDATE, { media: sanitizeEntity(res, { model: modelDef }) });
    return res;
  },

  async add(values, { user } = {}) {
    const fileValues = { ...values };
    if (user) {
      fileValues[UPDATED_BY_ATTRIBUTE] = user.id;
      fileValues[CREATED_BY_ATTRIBUTE] = user.id;
    }
    sendMediaMetrics(fileValues);

    const res = await siapi.query('file', 'upload').create(fileValues);
    const modelDef = siapi.getModel('file', 'upload');
    siapi.eventHub.emit(MEDIA_CREATE, { media: sanitizeEntity(res, { model: modelDef }) });
    return res;
  },

  fetch(params, populate) {
    return siapi.query('file', 'upload').findOne(params, populate);
  },

  fetchAll(params, populate) {
    combineFilters(params);
    return siapi.query('file', 'upload').find(params, populate);
  },

  search(params, populate) {
    return siapi.query('file', 'upload').search(params, populate);
  },

  countSearch(params) {
    return siapi.query('file', 'upload').countSearch(params);
  },

  count(params) {
    combineFilters(params);
    return siapi.query('file', 'upload').count(params);
  },

  async remove(file) {
    const config = siapi.plugins.upload.config;

    // execute delete function of the provider
    if (file.provider === config.provider) {
      await siapi.plugins.upload.provider.delete(file);

      if (file.formats) {
        await Promise.all(
          Object.keys(file.formats).map(key => {
            return siapi.plugins.upload.provider.delete(file.formats[key]);
          })
        );
      }
    }

    const media = await siapi.query('file', 'upload').findOne({
      id: file.id,
    });

    const modelDef = siapi.getModel('file', 'upload');
    siapi.eventHub.emit(MEDIA_DELETE, { media: sanitizeEntity(media, { model: modelDef }) });

    return siapi.query('file', 'upload').delete({ id: file.id });
  },

  async uploadToEntity(params, files, source) {
    const { id, model, field } = params;

    const arr = Array.isArray(files) ? files : [files];
    const enhancedFiles = await Promise.all(
      arr.map(file => {
        return this.enhanceFile(
          file,
          {},
          {
            refId: id,
            ref: model,
            source,
            field,
          }
        );
      })
    );

    await Promise.all(enhancedFiles.map(file => this.uploadFileAndPersist(file)));
  },

  getSettings() {
    return siapi
      .store({
        type: 'plugin',
        name: 'upload',
        key: 'settings',
      })
      .get();
  },

  setSettings(value) {
    if (value.responsiveDimensions === true) {
      siapi.telemetry.send('didEnableResponsiveDimensions');
    } else {
      siapi.telemetry.send('didDisableResponsiveDimensions');
    }

    return siapi
      .store({
        type: 'plugin',
        name: 'upload',
        key: 'settings',
      })
      .set({ value });
  },
};
