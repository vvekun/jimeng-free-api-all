import axios from "axios";
import logger from "./logger.ts";
import util from "./util.ts";

/**
 * 回调通知状态
 */
export type CallbackStatus = "submitted" | "processing" | "completed" | "failed";

/**
 * 回调通知类型
 */
export type CallbackType = "image" | "video";

/**
 * 回调通知负载
 */
export interface CallbackPayload {
  /** 任务唯一标识 */
  task_id: string;
  /** 生成类型: image / video */
  type: CallbackType;
  /** 模型名称 */
  model: string;
  /** 当前状态 */
  status: CallbackStatus;
  /** 进度百分比 0-100 */
  progress: number;
  /** 可读消息 */
  message: string;
  /** 任务创建时间戳 */
  created_at: number;
  /** 最近更新时间戳 */
  updated_at: number;
  /** 生成结果（仅在 completed 时存在） */
  result?: {
    urls: string[];
  };
  /** 错误信息（仅在 failed 时存在） */
  error?: {
    code: string;
    message: string;
  };
}

/**
 * 回调通知上下文，在整个生成过程中传递
 */
export interface CallbackContext {
  /** 回调目标 URL */
  callbackUrl: string;
  /** 任务唯一标识 */
  taskId: string;
  /** 生成类型 */
  type: CallbackType;
  /** 模型名称 */
  model: string;
  /** 任务创建时间 */
  createdAt: number;
}

// ========== 任务存储（内存） ==========

/** 任务存储记录 */
export interface TaskRecord {
  task_id: string;
  type: CallbackType;
  model: string;
  status: CallbackStatus;
  progress: number;
  message: string;
  created_at: number;
  updated_at: number;
  result?: { urls: string[] };
  error?: { code: string; message: string };
}

/** 内存中的任务存储 Map<taskId, TaskRecord> */
const taskStore = new Map<string, TaskRecord>();

/** 任务最大保留时长（毫秒），默认 30 分钟 */
const TASK_TTL_MS = 30 * 60 * 1000;

/** 定期清理过期任务（每 5 分钟） */
setInterval(() => {
  const now = Date.now();
  for (const [taskId, record] of taskStore) {
    if (now - record.updated_at * 1000 > TASK_TTL_MS) {
      taskStore.delete(taskId);
    }
  }
}, 5 * 60 * 1000);

/**
 * 更新任务存储中的记录
 */
function updateTaskStore(payload: CallbackPayload): void {
  taskStore.set(payload.task_id, {
    task_id: payload.task_id,
    type: payload.type,
    model: payload.model,
    status: payload.status,
    progress: payload.progress,
    message: payload.message,
    created_at: payload.created_at,
    updated_at: payload.updated_at,
    ...(payload.result ? { result: payload.result } : {}),
    ...(payload.error ? { error: payload.error } : {}),
  });
}

/**
 * 查询任务状态
 *
 * @param taskId 任务ID
 * @returns 任务记录，不存在返回 null
 */
export function getTaskStatus(taskId: string): TaskRecord | null {
  return taskStore.get(taskId) || null;
}

/**
 * 创建回调上下文
 *
 * @param callbackUrl 回调地址（可为空，仅做异步任务时也会创建上下文）
 * @param type 生成类型
 * @param model 模型名称
 * @returns 回调上下文，如果 callbackUrl 为空则返回 null
 */
export function createCallbackContext(
  callbackUrl: string | undefined,
  type: CallbackType,
  model: string
): CallbackContext | null {
  if (!callbackUrl) return null;

  const ctx: CallbackContext = {
    callbackUrl,
    taskId: util.uuid(),
    type,
    model,
    createdAt: util.unixTimestamp(),
  };

  // 立即在任务存储中创建初始记录
  updateTaskStore({
    task_id: ctx.taskId,
    type: ctx.type,
    model: ctx.model,
    status: "submitted",
    progress: 0,
    message: "任务已创建，等待处理",
    created_at: ctx.createdAt,
    updated_at: ctx.createdAt,
  });

  return ctx;
}

/**
 * 发送回调通知（异步，不阻塞主流程）
 * 同时更新内存中的任务记录
 *
 * @param ctx 回调上下文
 * @param status 状态
 * @param progress 进度 0-100
 * @param message 消息
 * @param extra 附加字段 (result / error)
 */
export async function sendCallback(
  ctx: CallbackContext | null,
  status: CallbackStatus,
  progress: number,
  message: string,
  extra?: {
    result?: { urls: string[] };
    error?: { code: string; message: string };
  }
): Promise<void> {
  if (!ctx) return;

  const payload: CallbackPayload = {
    task_id: ctx.taskId,
    type: ctx.type,
    model: ctx.model,
    status,
    progress: Math.min(100, Math.max(0, Math.round(progress))),
    message,
    created_at: ctx.createdAt,
    updated_at: util.unixTimestamp(),
    ...extra,
  };

  // 始终更新任务存储
  updateTaskStore(payload);

  // 如果有回调URL，发送HTTP通知
  if (ctx.callbackUrl) {
    try {
      logger.info(`发送回调通知: ${ctx.callbackUrl} status=${status} progress=${progress}%`);
      await axios.post(ctx.callbackUrl, payload, {
        timeout: 10000,
        headers: {
          "Content-Type": "application/json",
          "X-Callback-Task-Id": ctx.taskId,
          "X-Callback-Type": ctx.type,
        },
        proxy: false, // 避免走代理导致回调失败
      });
      logger.info(`回调通知发送成功: task_id=${ctx.taskId} status=${status}`);
    } catch (err) {
      // 回调失败不应影响主流程
      logger.warn(`回调通知发送失败: ${err.message}`);
    }
  }
}

/**
 * 便捷方法：发送 "已提交" 通知
 */
export function notifySubmitted(ctx: CallbackContext | null, message?: string) {
  return sendCallback(ctx, "submitted", 0, message || "任务已提交，等待处理");
}

/**
 * 便捷方法：发送 "处理中" 通知
 */
export function notifyProcessing(ctx: CallbackContext | null, progress: number, message?: string) {
  return sendCallback(ctx, "processing", progress, message || `生成中 (${Math.round(progress)}%)`);
}

/**
 * 便捷方法：发送 "已完成" 通知
 */
export function notifyCompleted(ctx: CallbackContext | null, urls: string[], message?: string) {
  return sendCallback(ctx, "completed", 100, message || "生成完成", {
    result: { urls },
  });
}

/**
 * 便捷方法：发送 "失败" 通知
 */
export function notifyFailed(ctx: CallbackContext | null, code: string, errorMessage: string) {
  return sendCallback(ctx, "failed", -1, `生成失败: ${errorMessage}`, {
    error: { code, message: errorMessage },
  });
}

export default {
  createCallbackContext,
  sendCallback,
  notifySubmitted,
  notifyProcessing,
  notifyCompleted,
  notifyFailed,
  getTaskStatus,
};
