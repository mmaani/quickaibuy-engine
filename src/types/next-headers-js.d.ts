declare module "next/headers.js" {
  export function headers(): Promise<Headers>;
  export function cookies(): Promise<unknown>;
  export function draftMode(): Promise<unknown>;
}
