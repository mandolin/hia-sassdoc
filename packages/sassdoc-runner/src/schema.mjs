export const SASSDOC_CONFIG_SCHEMA_VERSION = "0.1.0-draft";
export const SASSDOC_CONFIG_SCHEMA_ID = "https://mandolin.github.io/HIA-Documentation/schemas/sassdoc-config-0.1.0-draft.schema.json";

const relativePath = {
  type: "string",
  minLength: 1,
  not: {
    anyOf: [
      { pattern: "^(?:[A-Za-z]:|/|\\\\|[A-Za-z][A-Za-z0-9+.-]*:)" },
      { pattern: "(?:^|[\\\\/])\\.\\.(?:[\\\\/]|$)" }
    ]
  }
};

/** @lang zh-CN SassDoc 配置草案结构，坐标侧载为默认关闭的显式布尔选项。 @lang en Draft SassDoc configuration shape with an explicit coordinate-sidecar boolean disabled by default. */
export const SASSDOC_CONFIG_JSON_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: SASSDOC_CONFIG_SCHEMA_ID,
  title: "SassDoc Config",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "workspaceRoot", "outputDirectory", "inputs"],
  properties: {
    $schema: { const: SASSDOC_CONFIG_SCHEMA_ID },
    schemaVersion: { const: SASSDOC_CONFIG_SCHEMA_VERSION },
    workspaceRoot: relativePath,
    outputDirectory: relativePath,
    inputs: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "path"],
        properties: {
          kind: { enum: ["scss", "sass"] },
          path: relativePath,
          language: { type: "string", minLength: 1 },
          artifactBasePath: relativePath
        }
      }
    },
    options: {
      type: "object",
      additionalProperties: false,
      properties: {
        emitDocSourceMap: { type: "boolean" },
        emitCssSourceMap: { type: "boolean" },
        emitCoordinateProfile: { type: "boolean" },
        sourcesContentPolicy: { enum: ["none", "reference", "embed"] },
        writeResultManifest: { type: "boolean" },
        sassStyle: { enum: ["expanded", "compressed"] }
      }
    },
    profileIds: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]*$" }
    }
  }
});
