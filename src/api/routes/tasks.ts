import _ from 'lodash';

import Request from '@/lib/request/Request.ts';
import { getTaskStatus } from '@/lib/callback.ts';

export default {

    prefix: '/v1/tasks',

    get: {

        '/:taskId': async (request: Request) => {
            const taskId = request.params?.taskId;

            if (!taskId || !_.isString(taskId)) {
                throw new Error('缺少 taskId 参数');
            }

            const task = getTaskStatus(taskId);
            if (!task) {
                throw new Error(`任务不存在或已过期: ${taskId}`);
            }

            return task;
        }

    }

}
