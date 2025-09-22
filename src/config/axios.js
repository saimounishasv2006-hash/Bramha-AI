import axios from "axios";
import { err } from "./logger.js";

export const http = axios.create({ timeout: 30000 });

http.interceptors.response.use(
  (r) => r,
  async (e) => {
    const cfg = e.config || {};
    cfg.__retries = cfg.__retries || 0;
    const code = e.response?.status || e.code;
    const transient = [429, 500, 502, 503, 504, "ECONNRESET", "ETIMEDOUT"];
    if (cfg.__retries < 2 && transient.includes(code)) {
      cfg.__retries++;
      await new Promise((res) => setTimeout(res, 500 * cfg.__retries));
      return http(cfg);
    }
    err("HTTP failed:", code, e.response?.data || e.message);
    return Promise.reject(e);
  }
);
