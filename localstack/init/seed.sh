#!/bin/bash
# Runs inside LocalStack once it is ready (mounted into /etc/localstack/init/ready.d).
# Creates the control-plane table and bucket and uploads the generated-service
# template. Safe to re-run: existing resources are left as they are.
set -euo pipefail

TABLE="${SERVICE_TABLE:-KanobiTable}"
BUCKET="${BUCKET_NAME:-kanobi-local}"

if ! awslocal dynamodb describe-table --table-name "$TABLE" >/dev/null 2>&1; then
  echo "Creating table $TABLE"
  awslocal dynamodb create-table \
    --table-name "$TABLE" \
    --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
      AttributeName=ownerId,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
    --global-secondary-indexes \
      'IndexName=byOwner,KeySchema=[{AttributeName=ownerId,KeyType=HASH},{AttributeName=pk,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
    --billing-mode PAY_PER_REQUEST >/dev/null
fi

if ! awslocal s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  echo "Creating bucket $BUCKET"
  awslocal s3 mb "s3://$BUCKET"
fi

echo "Uploading boilerplate to s3://$BUCKET/boilerplate/"
awslocal s3 sync /kanobi/boilerplate "s3://$BUCKET/boilerplate/" \
  --delete --exclude ".env*" --exclude "node_modules/*" --exclude "dist/*"

echo "Kanobi seed complete"
