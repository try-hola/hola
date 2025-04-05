// This file acts as an aggregator for the app controller functions.
// It currently re-exports everything from apps.ts to facilitate incremental migration.

const monitoring = require("./monitoring");
const lifecycle = require("./lifecycle");
const info = require("./info");
const backup = require("./backup");

module.exports = {
  ...monitoring,
  ...lifecycle,
  ...info,
  ...backup,
};
