import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    restoreMocks: true,
    env: {
      TZ: "UTC",
      NODE_ENV: "test",
      STAGE_NAME: "test",
      SERVICE_TABLE: "KanobiTable",
      AWS_DEPLOY_REGION: "eu-west-1",
      CODEBUILD_PROJECT: "kanobi-deploy-test",
      CFN_EXECUTION_ROLE_ARN: "arn:aws:iam::123456789012:role/kanobi-cfn-execution-test",
      BUCKET_NAME: "kanobi-bucket",
      DYNAMODB_ENDPOINT: "http://localhost:8000",
      S3_ENDPOINT: "http://localhost:4566",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "lcov"],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
