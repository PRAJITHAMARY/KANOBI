import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  CopyObjectCommand,
  ListObjectsV2CommandOutput,
  _Object,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { logError, logInfo } from "./logger";
import { Project } from "ts-morph";
import { createReadStream } from "fs";
import { localEndpointConfig } from "./awsConfig";

const s3 = new S3Client({
  region: process.env.AWS_DEPLOY_REGION,
  forcePathStyle: true,
  ...(process.env.NODE_ENV == "dev"
    ? localEndpointConfig(process.env.S3_ENDPOINT)
    : {}),
});

const BUCKET = process.env.BUCKET_NAME;

export const uploadFile = async (key: string, body: Buffer | string) => {
  try {
    const response = await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
      })
    );

    return response;
  } catch (error) {
    logError(uploadFile.name, error);
  }
};

export const downloadFile = async (key: string): Promise<Readable | null> => {
  try {
    const res = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
      })
    );
    return res.Body as Readable;
  } catch (error) {
    logError(downloadFile.name, error);
    return null;
  }
};

export const listFolder = async (prefix: string) => {
  try {
    const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
    let continuationToken: string | undefined = undefined;
    let allKeys: _Object[] = [];

    do {
      const res: ListObjectsV2CommandOutput = await s3.send(
        new ListObjectsV2Command({
          Bucket: BUCKET,
          Prefix: normalizedPrefix,
          ContinuationToken: continuationToken,
        })
      );

      const keys = res.Contents?.map((x: any) => x);
      if (keys) allKeys.push(...keys);

      continuationToken = res.IsTruncated
        ? res.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return allKeys;
  } catch (error) {
    logError(listFolder.name, error);
    return [];
  }
};

export const deleteFolder = async (prefix: string) => {
  try {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix.endsWith("/") ? prefix : `${prefix}/`,
      })
    );

    if (!listed.Contents?.length) return;

    const objects = listed.Contents.map((obj: any) => ({ Key: obj.Key! }));

    await s3.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: objects },
      })
    );

    // deletes deployment zip if it exists
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: {
          Objects: [
            {
              Key: `${
                prefix.endsWith("/")
                  ? prefix.substring(0, prefix.indexOf("/") - 1)
                  : prefix
              }.zip`,
            },
          ],
        },
      })
    );
  } catch (error) {
    logError(deleteFolder.name, error);
  }
};

export const copyFolder = async (fromPrefix: string, toPrefix: string) => {
  try {
    const normalizedFrom = fromPrefix.endsWith("/")
      ? fromPrefix
      : `${fromPrefix}/`;
    const normalizedTo = toPrefix.endsWith("/") ? toPrefix : `${toPrefix}/`;

    const list = await listFolder(fromPrefix);

    const newKeys: string[] = [];

    for (const obj of list) {
      if (!obj.Key) continue;

      const newKey = obj.Key.replace(normalizedFrom, normalizedTo);
      newKeys.push(newKey);

      await s3.send(
        new CopyObjectCommand({
          Bucket: BUCKET,
          CopySource: `${BUCKET}/${obj.Key}`,
          Key: newKey,
        })
      );
    }

    return newKeys;
  } catch (error) {
    logError(copyFolder.name, error);
    return [];
  }
};

export const streamToString = async (
  stream: Readable | null
): Promise<string> => {
  if (!stream) {
    return "";
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    stream.on("data", (chunk) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    );
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
};

export const getSource = async (key: string) => {
  const indexCode = await streamToString(await downloadFile(key));

  const project = new Project({
    useInMemoryFileSystem: true,
  });

  const sourceFile = project.createSourceFile(key, indexCode, {
    overwrite: true,
  });

  return sourceFile;
};

export const readStreamToBuffer = (filePath: string) => {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: any[] = [];
    const stream = createReadStream(filePath);

    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
};

export const emptyBucket = async (bucket: string) => {
  logInfo(emptyBucket.name, `Emptying bucket: ${bucket}`);
  let isTruncated = true;
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;

  while (isTruncated) {
    const listResp = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      })
    );

    const objectsToDelete = (listResp.Versions || [])
      .concat(listResp.DeleteMarkers || [])
      .map((obj) => ({
        Key: obj.Key!,
        VersionId: obj.VersionId,
      }));

    if (objectsToDelete.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: objectsToDelete,
            Quiet: true,
          },
        })
      );

      logInfo(
        emptyBucket.name,
        `Deleted ${objectsToDelete.length} objects from ${bucket}`
      );
    }

    isTruncated = listResp.IsTruncated ?? false;
    keyMarker = listResp.NextKeyMarker;
    versionIdMarker = listResp.NextVersionIdMarker;
  }
};
