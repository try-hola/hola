// Single source of the CLI version, used for the --version banner and to default
// `hola bootstrap --ref` to the matching release tag (cli-v<version>) so the host
// builds a server image matching this CLI. Keep in sync with package.json.
export const CLI_VERSION = '0.3.0';
