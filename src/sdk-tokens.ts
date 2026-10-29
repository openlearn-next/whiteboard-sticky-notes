/**
 * 运行时 Token 的最小本地实现。
 *
 * 宿主在 ZIP 更新链路里（`PluginHost.reloadPlugin` → `extractManifest`）会把整包
 * 产物交给 EsmLoader，用 `data:text/javascript;base64,` 加载。data: URL 没有层级
 * 基址，裸说明符一律无法解析 —— 官方 SDK 构建把 `@openlearn/plugin-sdk` 标成
 * external，产物里的 `import ... from '@openlearn/plugin-sdk'` 因此会直接抛
 * ERR_MODULE_NOT_FOUND，更新接口返回 500。
 *
 * 插件在运行期只用到 Token 与 IDatabaseToken 两个值。宿主解析服务、校验 provides
 * 时都只比对 `token.name`（di/service-registry#resolve、plugin-host/context-builder
 * 的 resolve/provide），所以这里按同名同版本重建即可，与 SDK 导出的常量语义一致；
 * 类型声明仍然来自 @openlearn/plugin-sdk。
 */

/** 与 SDK 的 Token 保持相同的公开形状，保证 ctx.resolve / ctx.provide 的结构化赋值。 */
export class Token<T> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  readonly __serviceType?: T;

  public readonly name: string;
  public readonly version: string;

  constructor(name: string, version: string = '1.0.0') {
    this.name = name;
    this.version = version;
  }
}

/** 与 SDK 的 IDatabaseToken 同名同版本。 */
export const IDatabaseToken = new Token<unknown>('@openlearn/core:IDatabase', '1.0.0');
