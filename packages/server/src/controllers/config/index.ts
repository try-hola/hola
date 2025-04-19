// This file acts as an aggregator for the config controller functions.
const system = require("./system");
const app = require("./app");
const encrypted = require("./encrypted");

module.exports = {
  ...system,
  ...app,
  ...encrypted,
};
