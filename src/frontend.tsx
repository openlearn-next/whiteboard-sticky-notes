/**
 * 课堂便签插件 —— 前端入口 (dist/frontend.js)
 *
 * 遵循沙箱桥接模型 (v0.7.x / SDK 3.7.4)：
 *   - 本执行体位于独立的沙箱 iframe (display: none)，不含宿主 DOM 与 React；
 *   - 所有用户可见界面由宿主依据 manifest 声明式规范渲染（classroomTools、contributes）；
 *   - 运行时通过 ctx.ui.registerExtensionPoint 注册数据型扩展点；
 *   - 提供 activate / deactivate 契约与 invokeCommand / showToast 桥接。
 */

/**
 * 沙箱前端上下文接口声明。
 */
interface SandboxFrontendContext {
  pluginId: string;
  services: {
    frontendApi: {
      get<T = unknown>(path: string): Promise<{ success: boolean; result?: T; error?: string }>;
      post<T = unknown>(path: string, body?: unknown): Promise<{ success: boolean; result?: T; error?: string }>;
      del<T = unknown>(path: string): Promise<{ success: boolean; result?: T; error?: string }>;
    };
    storageService: {
      get(key: string): Promise<string | null>;
      set(key: string, value: unknown): Promise<boolean>;
      delete(key: string): Promise<boolean>;
    };
  };
  ui: {
    registerExtensionPoint(slot: string, config: Record<string, unknown>): Promise<boolean>;
    showToast(message: string): Promise<boolean>;
  };
  invokeCommand<T = unknown>(type: string, payload?: unknown): Promise<T>;
  context: {
    get(): Promise<{ lessonId: string | null; classId: string | null }>;
  };
}

let ctx: SandboxFrontendContext | null = null;

/**
 * 前端沙箱激活钩子。
 *
 * @param hostCtx 宿主注入的沙箱上下文对象
 */
async function activate(hostCtx: SandboxFrontendContext): Promise<void> {
  ctx = hostCtx;

  // 1. 读取当前课堂与班级上下文
  const { lessonId, classId } = await hostCtx.context.get();

  // 2. 隔离存储计数
  const openCount = Number((await hostCtx.services.storageService.get('openCount')) ?? 0) + 1;
  await hostCtx.services.storageService.set('openCount', String(openCount));

  // 3. 注册数据型扩展点：Ctrl+K 命令面板
  await hostCtx.ui.registerExtensionPoint('command_palette.item', {
    id: 'tool_sticky_notes-open',
    label: '课堂便签：查看便签看板',
    icon: 'StickyNote',
    slotProps: {
      title: '课堂便签：查看便签看板',
      description: '查看并管理当前课堂收集的所有便签卡片',
      category: 'Classroom',
      commandType: 'stickynotes.open_board',
      payload: { lessonId: '$lessonId', classId: '$classId' },
    },
  });

  console.info('[WhiteboardStickyNotes] 前端沙箱激活成功', { lessonId, classId, openCount });
}

/**
 * 前端沙箱停用钩子。
 */
async function deactivate(): Promise<void> {
  ctx = null;
}

/**
 * 宿主 Toast 消息推送通道。
 *
 * @param message 提示文本
 */
export async function notify(message: string): Promise<void> {
  await ctx?.ui.showToast(message);
}

export default { activate, deactivate };
