import _ from 'lodash';

import Request from '@/lib/request/Request.ts';
import Response from '@/lib/response/Response.ts';
import { tokenSplit } from '@/api/controllers/core.ts';
import { generateVideo, generateSeedanceVideo, isSeedanceModel, DEFAULT_MODEL } from '@/api/controllers/videos.ts';
import util from '@/lib/util.ts';
import { createCallbackContext, notifyFailed } from '@/lib/callback.ts';
import logger from '@/lib/logger.ts';

export default {

    prefix: '/v1/videos',

    post: {

        '/generations': async (request: Request) => {
            // 检查是否使用了不支持的参数
            const unsupportedParams = ['size', 'width', 'height'];
            const bodyKeys = Object.keys(request.body);
            const foundUnsupported = unsupportedParams.filter(param => bodyKeys.includes(param));

            if (foundUnsupported.length > 0) {
                throw new Error(`不支持的参数: ${foundUnsupported.join(', ')}。请使用 ratio 和 resolution 参数控制视频尺寸。`);
            }

            const contentType = request.headers['content-type'] || '';
            const isMultiPart = contentType.startsWith('multipart/form-data');

            request
                .validate('body.model', v => _.isUndefined(v) || _.isString(v))
                .validate('body.prompt', v => _.isUndefined(v) || _.isString(v))
                .validate('body.ratio', v => _.isUndefined(v) || _.isString(v))
                .validate('body.resolution', v => _.isUndefined(v) || _.isString(v))
                .validate('body.duration', v => {
                    if (_.isUndefined(v)) return true;
                    // 对于 multipart/form-data，允许字符串类型的数字
                    if (isMultiPart && typeof v === 'string') {
                        const num = parseInt(v);
                        // Seedance 支持 4-15 秒连续范围，普通视频支持 5 或 10 秒
                        return (num >= 4 && num <= 15) || num === 5 || num === 10;
                    }
                    // 对于 JSON，要求数字类型
                    // Seedance 支持 4-15 秒连续范围，普通视频支持 5 或 10 秒
                    return _.isFinite(v) && ((v >= 4 && v <= 15) || v === 5 || v === 10);
                })
                .validate('body.file_paths', v => _.isUndefined(v) || _.isArray(v))
                .validate('body.filePaths', v => _.isUndefined(v) || _.isArray(v))
                .validate('body.response_format', v => _.isUndefined(v) || _.isString(v))
                .validate('headers.authorization', _.isString);

            // refresh_token切分
            const tokens = tokenSplit(request.headers.authorization);
            // 随机挑选一个refresh_token
            const token = _.sample(tokens);

            const {
                model = DEFAULT_MODEL,
                prompt,
                ratio = "1:1",
                resolution = "720p",
                duration = 5,
                file_paths = [],
                filePaths = [],
                response_format = "url",
                callback_url,
            } = request.body;

            // 如果是 multipart/form-data，需要将字符串转换为数字
            const finalDuration = isMultiPart && typeof duration === 'string'
                ? parseInt(duration)
                : duration;

            // 兼容两种参数名格式：file_paths 和 filePaths
            const finalFilePaths = filePaths.length > 0 ? filePaths : file_paths;

            // 创建回调上下文
            const callbackContext = createCallbackContext(callback_url, 'video', model);

            // 如果有 callback_url，立即返回 task_id，后台异步执行生成
            if (callbackContext) {
                (async () => {
                    try {
                        let videoUrl: string;
                        if (isSeedanceModel(model)) {
                            const seedanceDuration = finalDuration === 5 ? 4 : finalDuration;
                            const seedanceRatio = ratio === "1:1" ? "4:3" : ratio;
                            videoUrl = await generateSeedanceVideo(
                                model, prompt,
                                { ratio: seedanceRatio, resolution, duration: seedanceDuration, filePaths: finalFilePaths, files: request.files },
                                token, callbackContext
                            );
                        } else {
                            videoUrl = await generateVideo(
                                model, prompt,
                                { ratio, resolution, duration: finalDuration, filePaths: finalFilePaths, files: request.files },
                                token, callbackContext
                            );
                        }
                        logger.info(`异步视频生成完成: task_id=${callbackContext.taskId}, url=${videoUrl}`);
                    } catch (err) {
                        logger.error(`异步视频生成失败: task_id=${callbackContext.taskId}, error=${err.message}`);
                        await notifyFailed(callbackContext, 'GENERATION_ERROR', err.message);
                    }
                })();

                return {
                    created: util.unixTimestamp(),
                    task_id: callbackContext.taskId,
                    status: "submitted",
                    message: "任务已提交，生成结果将通过回调通知推送",
                };
            }

            // 无 callback_url，保持原有同步行为
            let videoUrl: string;
            if (isSeedanceModel(model)) {
                // Seedance 2.0 多图智能视频生成
                // Seedance 默认时长为 4 秒，默认比例为 4:3
                const seedanceDuration = finalDuration === 5 ? 4 : finalDuration; // 如果是默认的5秒，转为4秒
                const seedanceRatio = ratio === "1:1" ? "4:3" : ratio; // 如果是默认的1:1，转为4:3

                videoUrl = await generateSeedanceVideo(
                    model,
                    prompt,
                    {
                        ratio: seedanceRatio,
                        resolution,
                        duration: seedanceDuration,
                        filePaths: finalFilePaths,
                        files: request.files,
                    },
                    token
                );
            } else {
                // 普通视频生成
                videoUrl = await generateVideo(
                    model,
                    prompt,
                    {
                        ratio,
                        resolution,
                        duration: finalDuration,
                        filePaths: finalFilePaths,
                        files: request.files,
                    },
                    token
                );
            }

            // 根据response_format返回不同格式的结果
            if (response_format === "b64_json") {
                // 获取视频内容并转换为BASE64
                const videoBase64 = await util.fetchFileBASE64(videoUrl);
                return {
                    created: util.unixTimestamp(),
                    data: [{
                        b64_json: videoBase64,
                        revised_prompt: prompt
                    }]
                };
            } else {
                // 默认返回URL
                return {
                    created: util.unixTimestamp(),
                    data: [{
                        url: videoUrl,
                        revised_prompt: prompt
                    }]
                };
            }
        }

    }

}
