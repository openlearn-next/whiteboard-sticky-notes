/**
 * 课堂便签插件 —— 类型契约与共享服务定义
 *
 * 定义对外服务接口与数据传输模型。
 */

import { Token } from '@openlearn/plugin-sdk';

/** 便签支持的语义颜色。 */
export type NoteColor = 'yellow' | 'pink' | 'blue' | 'green' | 'purple';

/** 便签状态。 */
export type NoteStatus = 'active' | 'archived';

/** 便签实体数据模型。 */
export interface StickyNote {
  /** 唯一标识 UUID。 */
  id: string;
  /** 课节 ID。 */
  lessonId: string;
  /** 班级 ID。 */
  classId: string;
  /** 作者用户 ID。 */
  authorId: string;
  /** 作者名称（匿名时前端回显『热心同学』）。 */
  authorName: string;
  /** 是否匿名提交 (0: 否, 1: 是)。 */
  isAnonymous: number;
  /** 便签文字内容（1~200 字）。 */
  content: string;
  /** 便签颜色。 */
  color: NoteColor;
  /** 是否置顶 (0: 否, 1: 是)。 */
  isPinned: number;
  /** 当前状态 (active: 活跃, archived: 归档/已删除)。 */
  status: NoteStatus;
  /** 创建毫秒时间戳。 */
  createdAt: number;
  /** 更新毫秒时间戳。 */
  updatedAt: number;
}

/** 创建便签输入载荷。 */
export interface CreateNotePayload {
  lessonId: string;
  classId: string;
  authorId: string;
  authorName: string;
  content: string;
  color?: NoteColor;
  isAnonymous?: boolean;
}

/** 列表查询输入载荷。 */
export interface ListNotesPayload {
  classId: string;
  lessonId?: string;
  status?: NoteStatus;
}

/** 置顶便签输入载荷。 */
export interface TogglePinPayload {
  noteId: string;
  isPinned?: boolean;
}

/** 删除便签输入载荷。 */
export interface DeleteNotePayload {
  noteId: string;
  actorId?: string;
}

/** 清屏输入载荷。 */
export interface ClearBoardPayload {
  classId: string;
  lessonId?: string;
}

/** 课堂便签公开服务接口契约。 */
export interface IWhiteboardStickyNotesService {
  /**
   * 创建一条新便签。
   *
   * @param payload 创建参数
   * @returns 创建完成的便签对象
   */
  createNote(payload: CreateNotePayload): Promise<StickyNote>;

  /**
   * 获取指定课堂下的便签列表。
   *
   * @param payload 查询过滤参数
   * @returns 排序后的便签列表
   */
  listNotes(payload: ListNotesPayload): Promise<StickyNote[]>;

  /**
   * 切换便签置顶状态。
   *
   * @param payload 置顶切换参数
   * @returns 是否置顶成功
   */
  togglePin(payload: TogglePinPayload): Promise<boolean>;

  /**
   * 归档/删除单条便签。
   *
   * @param payload 删除参数
   * @returns 是否删除成功
   */
  deleteNote(payload: DeleteNotePayload): Promise<boolean>;

  /**
   * 一键清空当前课堂活跃便签。
   *
   * @param payload 清空参数
   * @returns 受影响的便签条数
   */
  clearBoard(payload: ClearBoardPayload): Promise<number>;
}

/** 跨插件消费 Token。 */
export const WhiteboardStickyNotesServiceToken = new Token<IWhiteboardStickyNotesService>(
  '@openlearn-ext/whiteboard-sticky-notes:IWhiteboardStickyNotesService',
  '1.0.0',
);
