import express from "express";
import { configRoutes } from "./routes";
import dotenv from "dotenv";
import swaggerUi from "swagger-ui-express";
import YAML from "yamljs";
import path from "path";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, "../public")));

// Load OpenAPI document
const openApiDocument = YAML.load(path.join(__dirname, "../public/docs/openapi.yaml"));

app.use(express.json()); // Enable JSON parsing
app.use("/api", configRoutes);

// Serve OpenAPI UI
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📄 API Docs available at http://localhost:${PORT}/api-docs`);
});
