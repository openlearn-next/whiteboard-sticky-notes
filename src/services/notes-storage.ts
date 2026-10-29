/**
 * 课堂便签插件 —— SQLite 数据持久化层
 *
 * 封装对 notes 表的增删改查逻辑，兼容 inline 与 process 沙箱的 rawDb 调用。
 */

import type {
  StickyNote,
  CreateNotePayload,
  ListNotesPayload,
  TogglePinPayload,
  DeleteNotePayload,
  ClearBoardPayload,
  NoteColor,
  NoteStatus,
} from '../contracts/index.js';

/** 裸数据库驱动接口（同时兼容同步与异步返回值）。 */
export interface RawDatabase {
  prepare(sql: string): {
    run(...args: unknown[]): Promise<{ changes?: number }> | { changes?: number };
    all(...args: unknown[]): Promise<unknown[]> | unknown[];
    get(...args: unknown[]): Promise<unknown> | unknown;
  };
}

/** 数据库行字段结构。 */
interface NoteRow {
  id: string;
  lesson_id: string;
  class_id: string;
  author_id: string;
  author_name: string;
  is_anonymous: number;
  content: string;
  color: string;
  is_pinned: number;
  status: string;
  created_at: number;
  updated_at: number;
}

/**
 * 归一化作用域 ID。
 *
 * 客户端拿不到上下文时会回传 'default' / 'default_lesson' 这类兜底值，
 * 它们与真实 ID 不等价，必须按「未知」处理，否则会形成互不相交的假作用域。
 */
function normalizeScopeId(value: unknown): string | undefined {
  const raw = String(value ?? '').trim();
  if (!raw || raw === 'default' || raw === 'default_lesson') return undefined;
  return raw;
}

/**
 * 将数据库行对象转换为业务 StickyNote 模型。
 *
 * @param row 数据库返回的原始行数据
 * @returns 业务便签对象
 */
function rowToNote(row: NoteRow): StickyNote {
  return {
    id: row.id,
    lessonId: row.lesson_id,
    classId: row.class_id,
    authorId: row.author_id,
    authorName: row.is_anonymous ? '热心同学' : row.author_name,
    isAnonymous: row.is_anonymous,
    content: row.content,
    color: (row.color as NoteColor) || 'yellow',
    isPinned: row.is_pinned,
    status: (row.status as NoteStatus) || 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 课堂便签存储仓库。 */
export class NotesStorage {
  private readonly rawDb: RawDatabase;
  private readonly tableName: string;

  /**
   * 构造 NotesStorage 实例。
   *
   * @param rawDb 平台解析的 IDatabase 实例
   * @param tableName 带平台前缀的真实表名
   */
  constructor(rawDb: RawDatabase, tableName: string) {
    this.rawDb = rawDb;
    this.tableName = tableName;
  }

  /**
   * 初始化索引。
   */
  async initIndexes(): Promise<void> {
    await this.rawDb
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_notes_lesson_status ON ${this.tableName}(lesson_id, status, is_pinned DESC, created_at DESC)`,
      )
      .run();
  }

  /**
   * 创建一条新便签。
   *
   * @param payload 创建参数
   * @returns 创建完成的便签对象
   */
  async create(payload: CreateNotePayload): Promise<StickyNote> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const lessonId = normalizeScopeId(payload.lessonId) ?? '';
    const classId = normalizeScopeId(payload.classId) ?? '';
    const isAnonymous = payload.isAnonymous ? 1 : 0;
    const color = payload.color || 'yellow';
    const isPinned = 0;
    const status: NoteStatus = 'active';

    await this.rawDb
      .prepare(
        `INSERT INTO ${this.tableName} (
          id, lesson_id, class_id, author_id, author_name,
          is_anonymous, content, color, is_pinned, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        lessonId,
        classId,
        payload.authorId,
        payload.authorName,
        isAnonymous,
        payload.content.trim(),
        color,
        isPinned,
        status,
        now,
        now,
      );

    return {
      id,
      lessonId,
      classId,
      authorId: payload.authorId,
      authorName: isAnonymous ? '热心同学' : payload.authorName,
      isAnonymous,
      content: payload.content.trim(),
      color,
      isPinned,
      status,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 根据 ID 查询单条便签。
   *
   * @param noteId 便签 ID
   * @returns 便签对象或 null
   */
  async getById(noteId: string): Promise<StickyNote | null> {
    const row = (await this.rawDb
      .prepare(`SELECT * FROM ${this.tableName} WHERE id = ? LIMIT 1`)
      .get(noteId)) as NoteRow | undefined;
    return row ? rowToNote(row) : null;
  }

  /**
   * 查询课堂便签列表。
   *
   * @param payload 过滤参数
   * @returns 便签列表
   */
  async list(payload: ListNotesPayload): Promise<StickyNote[]> {
    const status = payload.status || 'active';
    // 便签墙与白板同域：以课节为准，课节未知时才退回班级。
    // 教师端的 classId 来自 liveClassSelectedClassId，学生端来自名单 class_id，
    // 二者不一致时若仍做 class_id + lesson_id 双重过滤，师生会互相看不到对方的便签。
    const lessonId = normalizeScopeId(payload.lessonId);
    const classId = normalizeScopeId(payload.classId);

    const where = ['status = ?'];
    const params: unknown[] = [status];
    if (lessonId) {
      where.push('lesson_id = ?');
      params.push(lessonId);
    } else if (classId) {
      where.push('class_id = ?');
      params.push(classId);
    }

    const sql = `SELECT * FROM ${this.tableName} WHERE ${where.join(' AND ')} ORDER BY is_pinned DESC, created_at DESC LIMIT 100`;
    const rows = (await this.rawDb.prepare(sql).all(...params)) as NoteRow[];
    return rows.map(rowToNote);
  }

  /**
   * 切换便签置顶状态。
   *
   * @param payload 置顶参数
   * @returns 是否更新成功
   */
  async togglePin(payload: TogglePinPayload): Promise<boolean> {
    const existing = await this.getById(payload.noteId);
    if (!existing) return false;

    const nextPinned = payload.isPinned !== undefined ? (payload.isPinned ? 1 : 0) : existing.isPinned ? 0 : 1;
    const now = Date.now();

    const res = (await this.rawDb
      .prepare(`UPDATE ${this.tableName} SET is_pinned = ?, updated_at = ? WHERE id = ?`)
      .run(nextPinned, now, payload.noteId)) as { changes?: number };

    return (res?.changes ?? 0) > 0;
  }

  /**
   * 软删除/归档单条便签。
   *
   * @param payload 删除参数
   * @returns 是否删除成功
   */
  async delete(payload: DeleteNotePayload): Promise<boolean> {
    const now = Date.now();
    const res = (await this.rawDb
      .prepare(`UPDATE ${this.tableName} SET status = 'archived', updated_at = ? WHERE id = ?`)
      .run(now, payload.noteId)) as { changes?: number };

    return (res?.changes ?? 0) > 0;
  }

  /**
   * 清屏归档当前课堂下的活跃便签。
   *
   * @param payload 清屏参数
   * @returns 归档条数
   */
  async clear(payload: ClearBoardPayload): Promise<number> {
    const now = Date.now();
    let res: { changes?: number };

    // 与 list 同口径：清屏必须清掉的正是当前便签墙展示的那一批便签。
    const lessonId = normalizeScopeId(payload.lessonId);
    const classId = normalizeScopeId(payload.classId);
    if (!lessonId && !classId) return 0;

    const scopeColumn = lessonId ? 'lesson_id' : 'class_id';
    const scopeValue = lessonId ?? classId;

    res = (await this.rawDb
      .prepare(
        `UPDATE ${this.tableName} SET status = 'archived', updated_at = ? WHERE ${scopeColumn} = ? AND status = 'active'`,
      )
      .run(now, scopeValue)) as { changes?: number };

    return res?.changes ?? 0;
  }
}
