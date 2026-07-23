const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '../..');
const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

// 1. Watch workspace root so Metro can resolve @workspace/* packages
config.watchFolders = [workspaceRoot];

// 2. Let Metro resolve modules from workspace root node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Ensure @workspace/* packages resolve from their source
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
