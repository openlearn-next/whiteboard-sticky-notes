/**
 * 课堂便签插件 —— 服务端入口 (dist/index.js)
 *
 * 遵循 OpenLearn V2 规范：
 *   - 强制满足 1:1 Action 与 CommandHandler 配对（防御 default-deny）；
 *   - 兼容 process 沙箱与 Node Permission 机制；
 *   - 使用全局 crypto.randomUUID()，不依赖 Node 原生内部模块裸导入；
 *   - SQLite 采用 ensureTable + rawDb 适配，提供稳定生命周期管理。
 */

import type { PluginContext } from '@openlearn/plugin-sdk';
import { IDatabaseToken } from '@openlearn/plugin-sdk';
import {
  WhiteboardStickyNotesServiceToken,
  type IWhiteboardStickyNotesService,
  type CreateNotePayload,
  type ListNotesPayload,
  type TogglePinPayload,
  type DeleteNotePayload,
  type ClearBoardPayload,
  type NoteColor,
} from './contracts/index.js';
import { NotesStorage } from './services/notes-storage.js';

const PLUGIN_ID = '@openlearn-ext/whiteboard-sticky-notes';
const NOTES_TABLE = 'notes';

const cleanups: Array<() => void | Promise<void>> = [];

export default {
  manifest: {
    id: PLUGIN_ID,
    name: '课堂便签',
    version: '0.1.2',
    main: 'index.js',
    executionMode: 'process',
    description: '基于 OpenLearn 的师生双轨制互动便签贴，支持多色卡片、实名/匿名发言、教师置顶与一键清屏',
    author: 'OpenLearn Developer',
    icon: 'StickyNote',
    engines: {
      openlearn: '>=0.7.0',
    },
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
    ],
    capabilitiesProposed: ['lesson:read', 'lesson:write'],
    classroomTools: [
      {
        id: 'tool_sticky_notes',
        name: '课堂便签',
        icon: 'StickyNote',
        commandType: 'whiteboard.draw',
        payload: {
          lessonId: '$lessonId',
          type: 'plugin',
          data: JSON.stringify({
            pluginId: PLUGIN_ID,
            teacherWidgetId: 'sticky_notes_board',
            studentWidgetId: 'sticky_notes_board',
            title: '课堂便签',
            width: 640,
            height: 480,
            x: 120,
            y: 80,
            page: 0,
          }),
        },
      },
    ],
    contributes: {
      'teacher.tab': [
        {
          id: 'tab_sticky_notes',
          label: '课堂便签',
          icon: 'StickyNote',
          view: 'storage/teacher.html',
          position: 35,
        },
      ],
      'teacher.dashboard.widget': [
        {
          id: 'sticky_notes_board',
          label: '课堂便签',
          icon: 'StickyNote',
          view: 'storage/teacher.html',
        },
      ],
      'student.view': [
        {
          id: 'sticky_notes_board',
          label: '课堂便签',
          icon: 'StickyNote',
          view: 'storage/student.html',
        },
      ],
      'student.classroom.overlay': [
        {
          id: 'ov_sticky_notes',
          label: '课堂便签',
          icon: 'StickyNote',
          view: 'storage/student.html?mode=compact',
        },
      ],
    },
  },

  /**
   * 插件激活入口。
   *
   * @param ctx 平台注入的插件上下文
   */
  async activate(ctx: PluginContext): Promise<void> {
    const { commandBus, actionRegistry, eventBus } = ctx.services;

    // 1. 初始化 SQLite 表结构与索引
    await ctx.db.ensureTable(
      NOTES_TABLE,
      `
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL,
      class_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      is_anonymous INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT 'yellow',
      is_pinned INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    `,
    );

    const rawDb = await ctx.resolve(IDatabaseToken);
    const storage = new NotesStorage(rawDb as never, ctx.db.table(NOTES_TABLE));
    await storage.initIndexes();

    // 2. 实现共享服务（仅在 inline 容器支持时通过 ctx.provide 暴露，沙箱模式安全跳过）
    const serviceImpl: IWhiteboardStickyNotesService = {
      async createNote(payload: CreateNotePayload) {
        return storage.create(payload);
      },
      async listNotes(payload: ListNotesPayload) {
        return storage.list(payload);
      },
      async togglePin(payload: TogglePinPayload) {
        return storage.togglePin(payload);
      },
      async deleteNote(payload: DeleteNotePayload) {
        return storage.delete(payload);
      },
      async clearBoard(payload: ClearBoardPayload) {
        return storage.clear(payload);
      },
    };
    if (typeof (ctx as any).provide === 'function') {
      try {
        (ctx as any).provide(WhiteboardStickyNotesServiceToken, serviceImpl);
      } catch (err) {
        ctx.log.warn(`[StickyNotes] ctx.provide skipped: ${(err as Error).message}`);
      }
    }

    // 3. 注册 Action 描述符（严守 1:1 配对，规避 Default-Deny 拦截）
    await actionRegistry.register({
      id: 'stickynotes-open-board',
      commandType: 'stickynotes.open_board',
      description: '课堂工具入口：打开课堂便签看板（事件流回显当前便签概览）',
      capabilityRequired: 'lesson:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '班级 ID' },
          lessonId: { type: 'STRING', description: '课节 ID' },
        },
      },
    });

    await actionRegistry.register({
      id: 'stickynotes-create-note',
      commandType: 'stickynotes.create_note',
      description: '创建并发布一条新的课堂便签',
      capabilityRequired: 'lesson:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '班级 ID' },
          lessonId: { type: 'STRING', description: '课节 ID' },
          authorId: { type: 'STRING', description: '作者用户 ID' },
          authorName: { type: 'STRING', description: '作者名称' },
          content: { type: 'STRING', description: '便签内容（1-200字）' },
          color: { type: 'STRING', description: '便签颜色 (yellow|pink|blue|green|purple)' },
          isAnonymous: { type: 'BOOLEAN', description: '是否匿名' },
        },
        required: ['classId', 'lessonId', 'authorId', 'content'],
      },
    });

    await actionRegistry.register({
      id: 'stickynotes-list-notes',
      commandType: 'stickynotes.list_notes',
      description: '获取当前课堂的便签列表（按置顶与时间排序）',
      capabilityRequired: 'lesson:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '班级 ID' },
          lessonId: { type: 'STRING', description: '课节 ID' },
          status: { type: 'STRING', description: '便签状态 (active|archived)' },
        },
        required: ['classId'],
      },
    });

    await actionRegistry.register({
      id: 'stickynotes-toggle-pin',
      commandType: 'stickynotes.toggle_pin',
      description: '置顶或取消置顶指定课堂便签',
      capabilityRequired: 'lesson:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          noteId: { type: 'STRING', description: '便签 ID' },
          isPinned: { type: 'BOOLEAN', description: '置顶目标状态' },
        },
        required: ['noteId'],
      },
    });

    await actionRegistry.register({
      id: 'stickynotes-delete-note',
      commandType: 'stickynotes.delete_note',
      description: '归档/删除指定课堂便签',
      capabilityRequired: 'lesson:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          noteId: { type: 'STRING', description: '便签 ID' },
          actorId: { type: 'STRING', description: '操作人 ID' },
        },
        required: ['noteId'],
      },
    });

    await actionRegistry.register({
      id: 'stickynotes-clear-board',
      commandType: 'stickynotes.clear_board',
      description: '一键清屏：归档当前课堂所有活跃便签',
      capabilityRequired: 'lesson:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '班级 ID' },
          lessonId: { type: 'STRING', description: '课节 ID' },
        },
        required: ['classId'],
      },
    });

    // 4. 注册命令处理器 (Handlers)
    await commandBus.registerHandler('stickynotes.open_board', {
      async execute(command) {
        const payload = (command.payload || {}) as { classId?: string; lessonId?: string };
        const classId = payload.classId ? String(payload.classId) : 'default';
        const lessonId = payload.lessonId ? String(payload.lessonId) : 'default';

        let elementCreated = false;
        if (lessonId && lessonId !== 'default') {
          try {
            await commandBus.execute({
              id: crypto.randomUUID(),
              type: 'whiteboard.draw',
              // 复用打开看板的 actor，避免以空身份向宿主内核白板写入元素
              actorId: command.actorId,
              payload: {
                lessonId,
                type: 'plugin',
                data: JSON.stringify({
                  pluginId: PLUGIN_ID,
                  teacherWidgetId: 'sticky_notes_board',
                  studentWidgetId: 'sticky_notes_board',
                  title: '课堂便签',
                  width: 640,
                  height: 480,
                  x: 120,
                  y: 80,
                  page: 0,
                }),
              },
            });
            elementCreated = true;
          } catch (e) {
            ctx.log.warn(`[StickyNotes] dispatch whiteboard.draw error: ${(e as Error).message}`);
          }
        }

        const notes = await storage.list({ classId, lessonId });
        const pinnedCount = notes.filter((n) => n.isPinned).length;

        return {
          opened: true,
          elementCreated,
          total: notes.length,
          pinnedCount,
          message: notes.length > 0 ? `当前课堂共收集 ${notes.length} 条便签（${pinnedCount} 条置顶）` : '当前课堂暂无便签，点击侧边栏即可开始张贴',
          notes: notes.slice(0, 10),
        };
      },
    });

    await commandBus.registerHandler('stickynotes.create_note', {
      async execute(command) {
        const payload = command.payload as {
          classId?: string;
          lessonId?: string;
          authorId?: string;
          authorName?: string;
          content?: string;
          color?: NoteColor;
          isAnonymous?: boolean;
        };

        const classId = String(payload?.classId ?? '').trim() || 'default';
        const lessonId = String(payload?.lessonId ?? '').trim() || 'default';
        const authorId = String(payload?.authorId ?? '').trim() || 'std_' + Math.random().toString(36).slice(2, 8);
        const authorName = String(payload?.authorName ?? '同学').trim();
        const content = String(payload?.content ?? '').trim();
        const color = (payload?.color || 'yellow') as NoteColor;
        const isAnonymous = Boolean(payload?.isAnonymous);

        if (!content) throw new Error('便签内容不能为空');
        if (content.length > 200) throw new Error('便签内容不能超过 200 字');

        const note = await storage.create({
          classId,
          lessonId,
          authorId,
          authorName,
          content,
          color,
          isAnonymous,
        });

        // 广播便签创建事件
        await eventBus.publish({
          id: crypto.randomUUID(),
          type: 'stickynotes.note_created',
          source: `plugin.${PLUGIN_ID}`,
          payload: {
            noteId: note.id,
            classId: note.classId,
            lessonId: note.lessonId,
            color: note.color,
            isAnonymous: note.isAnonymous,
            createdAt: note.createdAt,
          },
          timestamp: Date.now(),
          correlationId: command.id,
        });

        return { success: true, note };
      },
    });

    await commandBus.registerHandler('stickynotes.list_notes', {
      async execute(command) {
        const payload = (command.payload || {}) as {
          classId?: string;
          lessonId?: string;
          status?: 'active' | 'archived';
        };

        const classId = String(payload?.classId ?? '').trim() || 'default';
        const lessonId = payload?.lessonId ? String(payload.lessonId).trim() : undefined;
        const status = payload?.status || 'active';

        const notes = await storage.list({ classId, lessonId, status });
        return { notes };
      },
    });

    await commandBus.registerHandler('stickynotes.toggle_pin', {
      async execute(command) {
        const payload = command.payload as { noteId?: string; isPinned?: boolean };
        const noteId = String(payload?.noteId ?? '').trim();
        if (!noteId) throw new Error('缺少 noteId 参数');

        const ok = await storage.togglePin({
          noteId,
          isPinned: payload.isPinned,
        });

        if (ok) {
          const note = await storage.getById(noteId);
          if (note) {
            await eventBus.publish({
              id: crypto.randomUUID(),
              type: 'stickynotes.note_updated',
              source: `plugin.${PLUGIN_ID}`,
              payload: {
                noteId: note.id,
                classId: note.classId,
                lessonId: note.lessonId,
                isPinned: note.isPinned,
                updatedAt: note.updatedAt,
              },
              timestamp: Date.now(),
              correlationId: command.id,
            });
          }
        }

        return { success: ok, noteId };
      },
    });

    await commandBus.registerHandler('stickynotes.delete_note', {
      async execute(command) {
        const payload = command.payload as { noteId?: string; actorId?: string };
        const noteId = String(payload?.noteId ?? '').trim();
        if (!noteId) throw new Error('缺少 noteId 参数');

        const existing = await storage.getById(noteId);
        const ok = await storage.delete({ noteId, actorId: payload.actorId });

        if (ok && existing) {
          await eventBus.publish({
            id: crypto.randomUUID(),
            type: 'stickynotes.note_updated',
            source: `plugin.${PLUGIN_ID}`,
            payload: {
              noteId: existing.id,
              classId: existing.classId,
              lessonId: existing.lessonId,
              status: 'archived',
              updatedAt: Date.now(),
            },
            timestamp: Date.now(),
            correlationId: command.id,
          });
        }

        return { success: ok, noteId };
      },
    });

    await commandBus.registerHandler('stickynotes.clear_board', {
      async execute(command) {
        const payload = (command.payload || {}) as { classId?: string; lessonId?: string };
        const classId = String(payload?.classId ?? '').trim();
        const lessonId = payload.lessonId ? String(payload.lessonId).trim() : undefined;
        if (!classId && !lessonId) throw new Error('缺少 classId 或 lessonId 参数');

        const count = await storage.clear({ classId, lessonId });

        await eventBus.publish({
          id: crypto.randomUUID(),
          type: 'stickynotes.board_cleared',
          source: `plugin.${PLUGIN_ID}`,
          payload: {
            classId,
            lessonId,
            count,
            clearedAt: Date.now(),
          },
          timestamp: Date.now(),
          correlationId: command.id,
        });

        return { success: true, count };
      },
    });

    ctx.log.info('课堂便签 (@openlearn-ext/whiteboard-sticky-notes) 服务端激活成功');
  },

  /**
   * 插件停用清理。
   */
  async deactivate(): Promise<void> {
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      if (cleanup) {
        try {
          await cleanup();
        } catch {
          /* 忽略清理异常 */
        }
      }
    }
    console.info('课堂便签 (@openlearn-ext/whiteboard-sticky-notes) 已停用');
  },
};
