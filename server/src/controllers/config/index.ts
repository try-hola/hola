// This file acts as an aggregator for the config controller functions.

const configController = require("./config");
const system = require("./system");
const app = require("./app");
const encrypted = require("./encrypted");

module.exports = {
  ...configController,
  ...system,
  ...app,
  ...encrypted,
};
