import { z } from "zod";
import type { App, ModuleDef } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { accessToken, compact, gapi, gapiDownload, googleTestConnection, withQuery } from "./google-common";

/** Google Drive connector (production). Auth: Google OAuth2 (Phase B). */

const FILES = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink,parents";

const searchFiles: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Google Drive");
  const p = params as { query?: string; pageToken?: string; pageSize?: number };
  const json = await gapi<{ files?: unknown[]; nextPageToken?: string }>({
    method: "GET",
    url: withQuery(FILES, { q: p.query, fields: `files(${FIELDS}),nextPageToken`, pageSize: p.pageSize ?? 50, pageToken: p.pageToken }),
    token,
  });
  return [{ files: json.files ?? [], nextPageToken: json.nextPageToken } as Bundle];
};

const getFile: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Google Drive");
  const p = params as { fileId: string };
  const json = await gapi<Record<string, unknown>>({ method: "GET", url: withQuery(`${FILES}/${encodeURIComponent(p.fileId)}`, { fields: FIELDS }), token });
  return [json as Bundle];
};

const uploadFile: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Google Drive");
  const p = params as { name: string; content: string; mimeType?: string; parents?: string };
  const boundary = "cyflow_multipart_boundary";
  const metadata = compact({ name: p.name, mimeType: p.mimeType, parents: p.parents ? [p.parents] : undefined });
  const multipart = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    "",
    `--${boundary}`,
    `Content-Type: ${p.mimeType ?? "text/plain"}`,
    "",
    p.content ?? "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const json = await gapi<{ id: string; name: string; webViewLink?: string }>({
    method: "POST",
    url: withQuery(UPLOAD, { uploadType: "multipart", fields: FIELDS }),
    token,
    headers: { "content-type": `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  return [{ id: json.id, name: json.name, webViewLink: json.webViewLink } as Bundle];
};

const downloadFile: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Google Drive");
  const p = params as { fileId: string };
  const meta = await gapi<{ name?: string; mimeType?: string }>({ method: "GET", url: withQuery(`${FILES}/${encodeURIComponent(p.fileId)}`, { fields: "name,mimeType" }), token });
  const media = await gapiDownload(withQuery(`${FILES}/${encodeURIComponent(p.fileId)}`, { alt: "media" }), token);
  return [{ name: meta.name, mimeType: media.mimeType || meta.mimeType, base64: media.base64 } as Bundle];
};

const createFolder: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Google Drive");
  const p = params as { name: string; parents?: string };
  const json = await gapi<{ id: string; name: string }>({
    method: "POST",
    url: withQuery(FILES, { fields: FIELDS }),
    token,
    body: compact({ name: p.name, mimeType: FOLDER_MIME, parents: p.parents ? [p.parents] : undefined }),
  });
  return [{ id: json.id, name: json.name } as Bundle];
};

const moveFile: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Google Drive");
  const p = params as { fileId: string; destinationFolderId: string };
  const current = await gapi<{ parents?: string[] }>({ method: "GET", url: withQuery(`${FILES}/${encodeURIComponent(p.fileId)}`, { fields: "parents" }), token });
  const json = await gapi<{ id: string; parents?: string[] }>({
    method: "PATCH",
    url: withQuery(`${FILES}/${encodeURIComponent(p.fileId)}`, { addParents: p.destinationFolderId, removeParents: (current.parents ?? []).join(","), fields: FIELDS }),
    token,
    body: {},
  });
  return [{ id: json.id, parents: json.parents } as Bundle];
};

const copyFile: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Google Drive");
  const p = params as { fileId: string; name?: string; parents?: string };
  const json = await gapi<{ id: string; name: string }>({
    method: "POST",
    url: withQuery(`${FILES}/${encodeURIComponent(p.fileId)}/copy`, { fields: FIELDS }),
    token,
    body: compact({ name: p.name, parents: p.parents ? [p.parents] : undefined }),
  });
  return [{ id: json.id, name: json.name } as Bundle];
};

const deleteFile: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Google Drive");
  const p = params as { fileId: string };
  await gapi({ method: "DELETE", url: `${FILES}/${encodeURIComponent(p.fileId)}`, token });
  return [{ deleted: true, fileId: p.fileId } as Bundle];
};

export const driveApp: App = {
  key: "drive",
  name: "Google Drive",
  auth: { type: "oauth2" },
  modules: {
    search_files: { key: "search_files", name: "Search files", kind: "search", params: z.object({ query: z.string().optional(), pageToken: z.string().optional(), pageSize: z.number().optional() }), run: searchFiles },
    get_file: { key: "get_file", name: "Get a file", kind: "search", params: z.object({ fileId: z.string() }), run: getFile },
    upload_file: { key: "upload_file", name: "Upload a file", kind: "action", params: z.object({ name: z.string(), content: z.string(), mimeType: z.string().optional(), parents: z.string().optional() }), run: uploadFile },
    download_file: { key: "download_file", name: "Download a file", kind: "search", params: z.object({ fileId: z.string() }), run: downloadFile },
    create_folder: { key: "create_folder", name: "Create a folder", kind: "action", params: z.object({ name: z.string(), parents: z.string().optional() }), run: createFolder },
    move_file: { key: "move_file", name: "Move a file", kind: "action", params: z.object({ fileId: z.string(), destinationFolderId: z.string() }), run: moveFile },
    copy_file: { key: "copy_file", name: "Copy a file", kind: "action", params: z.object({ fileId: z.string(), name: z.string().optional(), parents: z.string().optional() }), run: copyFile },
    delete_file: { key: "delete_file", name: "Delete a file", kind: "action", params: z.object({ fileId: z.string() }), run: deleteFile },
  },
  testConnection: googleTestConnection,
};
