# [Bug] 白板插件卡片 `PluginCardRenderer` 短路渲染 `NullExtensionComponent`，manifest `view` 分支永不可达

> 本文件由 openlearn-next-plugin-dev skill 生成，用于向 OpenLearnV2 系统作者提交缺陷报告。

- **报告人**：OpenLearn 插件开发者
- **联系方式**：GitHub / 本地工单
- **报告日期**：2026-10-29
- **严重程度**：功能受损（所有把 `contributes.*.view` 放进白板卡片的插件，学生端 / 教师端卡片均为空白）
- **影响范围**：任何通过 `contributes` 声明 `view` 的可视沙箱插件；典型场景是本插件的课堂便签、以及所有「课堂工具 → 白板插件元素」类插件

---

## 一、环境信息

| 项 | 值 |
|----|----|
| OpenLearnV2 系统版本 | `0.7.7` |
| `@openlearn/plugin-sdk` 版本 | `3.7.4` |
| 故障插件 ID / 版本 | `@openlearn-ext/whiteboard-sticky-notes` / `0.1.1` |
| 插件 `execution_mode` | `process`（第三方 ZIP 安装默认隔离模式） |
| 插件 `engines.openlearn` | `>=0.7.0` |
| 运行时 | Node `v22.16.0` / Linux x86_64 |
| 部署方式 | 本地源码部署 (`http://localhost:9000`) |

---

## 二、问题摘要

教师通过 `classroomTools` 下发「课堂便签」后，白板出现插件卡片（标题栏、边框、缩放把手均正常），**卡片内容区完全空白**；
学生端同一个 `student.view` 贡献在其它入口（如学生仪表盘）用 `ExtensionPointRenderer` 渲染正常，
但在白板卡片里同样空白，且**不会**出现「组件 [...] 正在加载或未启用...」的占位提示（说明扩展点已找到）。

只有把视图放进白板卡片时复现；同一份 `storage/student.html`、同一套 manifest、同一扩展点 id 都能在 `ExtensionPointRenderer` 路径正常显示。

---

## 三、复现步骤

1. 安装并启用 `@openlearn-ext/whiteboard-sticky-notes@0.1.1`（manifest 见下，节选）。
2. 教师进入课堂，点击课堂工具「课堂便签」。
3. 白板出现 640×480 的插件卡片：标题栏正常，内容区空白。
4. 打开控制台，确认扩展点存在且带 `view`：

```js
// 期望：'student.view' 与 'teacher.dashboard.widget' 各有一条 { id:'sticky_notes_board', view:'storage/student.html' }
usePluginHostStore.getState().extensionPoints.get('student.view')
```

5. 对照：同一扩展点在学生仪表盘（`ExtensionPointRenderer`）中显示正常。

### 相关 manifest 片段

```json
{
  "classroomTools": [
    {
      "id": "tool_sticky_notes",
      "commandType": "whiteboard.draw",
      "payload": {
        "type": "plugin",
        "data": "{\"pluginId\":\"@openlearn-ext/whiteboard-sticky-notes\",\"teacherWidgetId\":\"sticky_notes_board\",\"studentWidgetId\":\"sticky_notes_board\"}"
      }
    }
  ],
  "contributes": {
    "teacher.dashboard.widget": [{ "id": "sticky_notes_board", "label": "课堂便签", "view": "storage/teacher.html" }],
    "student.view": [{ "id": "sticky_notes_board", "label": "课堂便签", "view": "storage/student.html" }],
    "student.classroom.overlay": [{ "id": "ov_sticky_notes", "label": "课堂便签", "view": "storage/student.html?mode=compact" }]
  }
}
```

> `student.classroom.overlay`（浮层）走 `ExtensionPointRenderer`，显示正常；只有白板卡片路径异常。

---

## 四、代码级根因定位

`src/features/whiteboard/widgets/PluginCardRenderer.tsx`（第 48~73 行，平台 v0.7.7）：

```tsx
useEffect(() => {
  if (!ext) return;
  if (containerRef.current) {
    containerRef.current.innerHTML = '';
    if (!ext.component && (ext as any).render) {          // ← manifest 贡献的 component 恒为真（占位组件），DOM render 同样被跳过
      Promise.resolve((ext as any).render(containerRef.current, { elementId, lessonId })).catch(console.error);
    }
  }
}, [ext, pluginId, widgetId, elementId, lessonId]);

// ...

if (ext.component) {                                      // ← 第 54 行：恒为 true
  return React.createElement(ext.component as any, { elementId, lessonId });
}

const viewPath = (ext as any).slotProps?.view || ext.view; // ← 第 58 行：永远走不到
if (viewPath) {
  return (
    <PluginSandboxIframeView ... variant="panel" />
  );
}
```

而 manifest 贡献的注册路径**必然**写入占位组件 —— `src/plugin-host/plugin-host.ts:186-254`：

```ts
store.registerExtensionPoint(slotName as AnyExtensionSlot, {
  id: entryId,
  label: String(entry.title ?? entry.label ?? entry.name ?? entryId),
  icon: typeof entry.icon === 'string' ? entry.icon : undefined,
  view: typeof entry.view === 'string' ? entry.view : undefined,   // view 正确落库
  slotProps: /* ... */,
  component: NullExtensionComponent,                                // 第 246 行：恒为占位组件
  pluginId,
  origin: 'manifest',
});
```

`NullExtensionComponent` 定义（`src/plugin-host/plugin-host.ts:142`）：

```ts
export const NullExtensionComponent = () => null;
```

因此 `React.createElement(NullExtensionComponent)` 渲染为 `null`，卡片内容区空白，且 `view` 永远无法渲染。

### 对照：`ExtensionPointRenderer` 的判定是正确的

`src/plugin-host/extension-point-renderer.tsx:506`（另见 969 行）：

```ts
const isReact = typeof activeExt.component === 'function' && activeExt.component !== NullExtensionComponent;
```

即平台已知「`component === NullExtensionComponent` 表示这是数据型 / view 型贡献，不是 React 组件」，但 `PluginCardRenderer` 漏掉了这个判定。

---

## 五、影响面

| 场景 | 结果 |
|------|------|
| `classroomTools` 下发 `type:'plugin'` 元素（教师端 `teacher.dashboard.widget`） | 卡片空白 |
| 学生端 `student.view` 贡献被白板卡片渲染 | 卡片空白 |
| 运行时（`registerExtensionPoint`）注册的 React 组件贡献 | 正常（`component` 是真实组件） |
| 运行时注册的 DOM `render` 贡献（无 `component`） | 正常（`!ext.component` 为真） |
| 同一贡献在 `ExtensionPointRenderer` 路径（侧栏 / 仪表盘 / 浮层） | 正常 |

即：**只有「manifest 声明 view + 白板卡片」这一交叉场景失效**，恰是第三方沙箱插件做课堂大屏互动的主路径。

---

## 六、建议修复

`src/features/whiteboard/widgets/PluginCardRenderer.tsx`：引入与 `ExtensionPointRenderer` 一致的占位组件判定。

```tsx
import { NullExtensionComponent } from '../../../plugin-host/plugin-host';

// ...
const hasReactComponent =
  typeof ext.component === 'function' && ext.component !== NullExtensionComponent;

useEffect(() => {
  if (!ext) return;
  if (containerRef.current) {
    containerRef.current.innerHTML = '';
    if (!hasReactComponent && (ext as any).render) {
      Promise.resolve((ext as any).render(containerRef.current, { elementId, lessonId })).catch(console.error);
    }
  }
}, [ext, pluginId, widgetId, elementId, lessonId, hasReactComponent]);

// ...
if (hasReactComponent) {
  return React.createElement(ext.component as any, { elementId, lessonId });
}
```

> 注：`useEffect` 的 `!ext.component` 判定同样会命中占位组件，导致「manifest 贡献 + DOM render」也被跳过；建议一并改为 `!hasReactComponent`。
> `NullExtensionComponent` 已从 `src/plugin-host/plugin-host.ts` 导出，无需新增导出。

### 建议回归测试

在 `PluginCardRenderer` 现有测试（如有）或新增用例中断言：manifest 形态的扩展点（`component: NullExtensionComponent` + `view: 'storage/x.html'`）应渲染 `PluginSandboxIframeView`（或 iframe），而不是空节点。

### 备用方案（若短期不修平台）

插件侧无可用绕行路径：远程插件不能向宿主传函数，无法在运行时把 `view` 变成 `component`。
只能先依赖 `student.classroom.overlay` 浮层承载全部交互（本插件 0.1.1 已把浮层收敛为紧凑输入条），
但「学生在大屏卡片里看便签墙」必须等平台修复后才可见。

---

## 七、验收标准

- [ ] 教师下发任意声明了 `contributes.<slot>.view` 的插件元素，白板卡片内呈现沙箱 iframe 页面（非空白）。
- [ ] 学生端白板卡片同样呈现 `student.view` 的 `view` 页面。
- [ ] 真实 React 组件贡献（inline 内建插件）不受影响。
- [ ] DOM `render` 贡献在不带 `component` 时仍正常。
- [ ] `ExtensionPointRenderer` 既有路径无回归。

---

## 八、附：证据收集命令

```bash
# 1. 确认短路点
sed -n '48,73p' src/features/whiteboard/widgets/PluginCardRenderer.tsx
# 2. 确认 manifest 贡献恒带占位组件
sed -n '240,250p' src/plugin-host/plugin-host.ts
# 3. 对照正确判定
sed -n '506p' src/plugin-host/extension-point-renderer.tsx
```

浏览器控制台：

```js
const exts = usePluginHostStore.getState().extensionPoints.get('student.view');
console.table(exts.map(e => ({ id: e.id, view: e.view, component: e.component?.name || typeof e.component })));
// 预期看到 component: 'NullExtensionComponent' 且 view: 'storage/student.html'
```
