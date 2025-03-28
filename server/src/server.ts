const express = require("express");
const { registerRoutes } = require("./routes");
const dotenv = require("dotenv");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const path = require("path");
const { PORT, STORAGE_ROOT } = require("./config");
const fs = require("fs-extra");

dotenv.config();
const app = express();

// Ensure storage directory exists
fs.ensureDirSync(STORAGE_ROOT);

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, "../public")));

// Load OpenAPI document
const openApiDocument = YAML.load(path.join(__dirname, "../public/docs/openapi.yaml"));

app.use(express.json()); // Enable JSON parsing

// Register API routes
registerRoutes(app);

// Serve OpenAPI UI
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📄 API Docs available at http://localhost:${PORT}/api-docs`);
  console.log(`📁 Storage root: ${STORAGE_ROOT}`);
});
