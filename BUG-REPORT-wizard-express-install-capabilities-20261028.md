# [Bug] 插件安装向导「一键极速安装」未默认传入 approveCapabilities=true 导致沙箱插件激活 500

> 本文件由 openlearn-next-plugin-dev skill 生成，用于向 OpenLearnV2 系统作者提交缺陷报告。

- **报告人**：OpenLearn 插件开发者
- **联系方式**：GitHub / 本地工单
- **报告日期**：2026-10-28
- **严重程度**：功能受损（阻塞第三方沙箱插件的一键极速安装体验，分步安装正常）
- **影响范围**：所有声明了 `capabilitiesProposed` 且运行在 Worker/Process 模式下的第三方插件

---

## 一、环境信息

| 项 | 值 |
|----|----|
| OpenLearnV2 系统版本 | `0.7.7` |
| `@openlearn/plugin-sdk` 版本 | `3.7.4` |
| 故障插件 ID / 版本 | `@openlearn-ext/whiteboard-sticky-notes` / `0.1.0` |
| 插件 `execution_mode` | `process`（第三方 ZIP 安装默认隔离模式） |
| 插件 `engines.openlearn` | `>=0.7.0` |
| 运行时 | Node `v22.16.0` / Linux x86_64 |
| 部署方式 | 本地源码部署 (`http://localhost:9000`) |

---

## 二、问题摘要

在管理后台（`/#/plugins`）使用「从 ZIP 安装」时，如果点击弹窗左下角的 **「⚡ 一键极速安装」（Express Install）**，插件上传后在自动调用 `/api/plugins/:id/toggle` 启用时会报 HTTP 500（`WorkerCapabilityError: no granted capability, only 'get' methods allowed`）；
而如果点击右下角的 **「下一步」逐步完成四步安装向导** 并在第 4 步手动勾选「确认授予清单申请的能力」，则可以 100% 成功安装并激活。

---

## 三、代码级根因定位

缺陷位于前端向导组件：`src/components/PluginInstallWizard.tsx` 中的 `handleExpressInstall` 函数（第 567~574 行）。

```tsx
// src/components/PluginInstallWizard.tsx (Line 548-575)
const handleExpressInstall = async () => {
  if (!file || processing || installing) return;
  setAgreedToTerms(true);
  setAllowDowngrade(true);
  setConfirmInUse(true);

  setInstalling(true);
  // ... 提示文案：极速同意全套授权，正在安装...
  try {
    await onConfirmInstall(file, effectiveMode, {
      mode: isUpgrade ? 'update' : 'install',
      targetPluginId: existingInstall?.pluginId,
      allowDowngrade: true,
      approvePublicRoutes,    // ❌ 错误：此处传递的是 React state 变量（初始值 false）
      approveCapabilities,    // ❌ 错误：此处传递的是 React state 变量（初始值 false）
      approveNetworkHosts,    // ❌ 错误：此处传递的是 React state 变量（初始值 false）
    });
    // ...
```

### 机制剖析
1. `PluginInstallWizard.tsx` 第 234 行初始化：
   ```tsx
   const [approveCapabilities, setApproveCapabilities] = useState(false);
   ```
2. 用户在向导第一步直接点击「⚡ 一键极速安装」时，`handleExpressInstall` 虽然向用户提示「极速同意全套授权」，但在调用 `onConfirmInstall` 时直接透传了 `approveCapabilities`（其值仍为组件初始的 `false`），且没有硬编码为 `true`。
3. 后端 `server/routes/plugins.ts` 收到的请求头缺少 `X-Approve-Capabilities: true`，因此未向 `plugin_capability_grants` 写入授权记录。
4. 安装完成后向导立即发起 `/api/plugins/:id/toggle` 请求；
5. 在 `packages/core/worker-runtime/service-host.ts:725` 的 Security Barrier 2 处：
   ```ts
   if (this.effectiveCapabilities.length === 0 && !msg.method.startsWith('get')) {
     throw new WorkerCapabilityError(
       this.pluginActorId,
       '__rpc__',
       `Capability denied for actor ${this.pluginActorId}: no granted capability, only 'get' methods allowed`,
     );
   }
   ```
   因为已授予能力为空，Worker 拒绝任何非 `get*` 前缀的调用（包括插件建表 `prepareAndRun`），导致抛出 500 异常。
6. 而在逐步安装（Step-by-step）流程中，用户在第 4 步手动勾选了复选框，触发了 `setApproveCapabilities(true)`，因此常规安装能正常通过。

---

## 四、复现步骤

1. 准备任意包含 `capabilitiesProposed: ["lesson:read"]` 且在 `activate()` 中建表或注册命令的第三方 ZIP 插件；
2. 进入 OpenLearn 管理后台 →「系统设置」→「插件中心」；
3. 点击「从 ZIP 安装」，选中插件 ZIP 包；
4. 在弹出的 `PluginInstallWizard` 向导界面中，**直接点击底部的「⚡ 一键极速安装」按钮**；
5. 观察控制台网络请求：插件上传成功后，随后的 `POST /api/plugins/<id>/toggle` 返回 500 报错。

---

## 五、修复建议与实施状态

在 `src/components/PluginInstallWizard.tsx` 的 `handleExpressInstall` 中，明确将权限审批参数强制置为 `true`：

```diff
--- a/src/components/PluginInstallWizard.tsx
+++ b/src/components/PluginInstallWizard.tsx
@@ -568,9 +568,9 @@ export function PluginInstallWizard({
         mode: isUpgrade ? 'update' : 'install',
         targetPluginId: existingInstall?.pluginId,
         allowDowngrade: true,
-        approvePublicRoutes,
-        approveCapabilities,
-        approveNetworkHosts,
+        approvePublicRoutes: true,
+        approveCapabilities: true,
+        approveNetworkHosts: true,
       });
```

**实施状态**：已按照用户授权在本地平台代码中完成修复，Vite 开发服务器已实时热重载生效。
