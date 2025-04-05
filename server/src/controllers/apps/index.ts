// This file acts as an aggregator for the app controller functions.

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
