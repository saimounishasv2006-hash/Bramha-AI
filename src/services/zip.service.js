import AdmZip from "adm-zip";

export const makeZipBuffer = (files /* [{path,content}] */) => {
  const zip = new AdmZip();
  files.forEach((f) => zip.addFile(f.path, Buffer.from(f.content, "utf8")));
  return zip.toBuffer();
};
