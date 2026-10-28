import type { AppBridge } from "@shared/types";

declare global {
  interface Window {
    prism: AppBridge;
  }
}

export {};
