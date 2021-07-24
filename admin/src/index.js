// NOTE TO PLUGINS DEVELOPERS:
// If you modify this file by adding new options to the plugin entry point
// Here's the file: siapi/docs/3.0.0-beta.x/plugin-development/frontend-field-api.md
// Here's the file: siapi/docs/3.0.0-beta.x/guides/registering-a-field-in-admin.md
// Also the siapi-generate-plugins/files/admin/src/index.js needs to be updated
// IF THE DOC IS NOT UPDATED THE PULL REQUEST WILL NOT BE MERGED
import React from 'react';
import { CheckPagePermissions } from 'siapi-helper-plugin';
import pluginPkg from '../../package.json';
import pluginLogo from './assets/images/logo.svg';
import pluginPermissions from './permissions';
import App from './containers/App';
import Initializer from './containers/Initializer';
import SettingsPage from './containers/SettingsPage';
import InputMedia from './components/InputMedia';
import InputModalStepper from './containers/InputModalStepper';

import trads from './translations';
import pluginId from './pluginId';
import { getTrad } from './utils';

export default siapi => {
  const pluginDescription = pluginPkg.siapi.description || pluginPkg.description;
  const icon = pluginPkg.siapi.icon;
  const name = pluginPkg.siapi.name;

  const plugin = {
    blockerComponent: null,
    blockerComponentProps: {},
    description: pluginDescription,
    fileModel: null,
    icon,
    id: pluginId,
    initializer: Initializer,
    injectedComponents: [],
    isReady: false,
    isRequired: pluginPkg.siapi.required || false,
    layout: null,
    lifecycles: null,
    mainComponent: App,
    name,
    pluginLogo,
    preventComponentRendering: false,
    settings: {
      global: {
        links: [
          {
            title: {
              id: getTrad('plugin.name'),
              defaultMessage: 'Media Library',
            },
            name: 'media-library',
            to: `${siapi.settingsBaseURL}/media-library`,
            Component: () => (
              <CheckPagePermissions permissions={pluginPermissions.settings}>
                <SettingsPage />
              </CheckPagePermissions>
            ),
            permissions: pluginPermissions.settings,
          },
        ],
      },
    },
    trads,
    menu: {
      pluginsSectionLinks: [
        {
          destination: `/plugins/${pluginId}`,
          icon,
          label: {
            id: `${pluginId}.plugin.name`,
            defaultMessage: 'Media Library',
          },
          name,
          permissions: pluginPermissions.main,
        },
      ],
    },
  };

  siapi.registerComponent({ name: 'media-library', Component: InputModalStepper });
  siapi.registerField({ type: 'media', Component: InputMedia });

  return siapi.registerPlugin(plugin);
};
