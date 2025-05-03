// test-register.js for Node.js test runner TypeScript support
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "CommonJS",
  },
});
