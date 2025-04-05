// This file acts as an aggregator for the app controller functions.
// It currently re-exports everything from apps.ts to facilitate incremental migration.

const appsController = require("./apps");
const lifecycle = require("./lifecycle");
const info = require("./info");

module.exports = {
  ...appsController,
  ...lifecycle,
  ...info,
};
