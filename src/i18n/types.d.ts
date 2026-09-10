import "i18next";
import type { defaultNS, resources } from "./index";

/**
 * 让 t() 的键名在编译期报错。
 * 取 zh-CN 的结构作为键源；两个语言的键集合由 locales.test.ts 强制对齐。
 */
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: (typeof resources)["zh-CN"];
  }
}
