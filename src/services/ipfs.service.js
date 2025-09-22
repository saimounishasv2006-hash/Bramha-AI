import { http } from "../config/axios.js";

export const uploadZipToIPFS = async (zipBuffer) => {
  const token = process.env.WEB3_STORAGE_TOKEN;
  if (!token) return null;
  const { data } = await http.post(
    "https://api.web3.storage/upload",
    zipBuffer,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/zip",
      },
      maxBodyLength: Infinity,
    }
  );
  const cid = data?.cid || data?.value?.cid || null;
  return cid;
};
